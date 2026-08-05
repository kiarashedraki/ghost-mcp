#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { api, cleanupTmp, downloadToTmp } from "./ghost.js";

const server = new McpServer({ name: "ghost-admin-mcp", version: "0.1.0" });

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown): ToolResult {
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e !== null
        ? JSON.stringify(e)
        : String(e);
  return { content: [{ type: "text", text: `Ghost API error: ${message}` }], isError: true };
}

/** Trim a post/page down to the fields an LLM needs for browsing. */
function summarize(p: any) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    url: p.url,
    published_at: p.published_at,
    updated_at: p.updated_at,
    featured: p.featured,
    tags: p.tags?.map((t: any) => t.name),
    custom_excerpt: p.custom_excerpt,
  };
}

const browseSchema = {
  limit: z.number().int().min(1).max(100).default(15).describe("Results per page (max 100)"),
  page: z.number().int().min(1).default(1).describe("Page number"),
  filter: z
    .string()
    .optional()
    .describe("Ghost NQL filter, e.g. \"status:draft\" or \"tag:recipes+status:published\""),
  order: z.string().optional().describe("Sort order, e.g. \"published_at desc\""),
};

const readSchema = {
  id: z.string().optional().describe("Ghost id (24-char hex)"),
  slug: z.string().optional().describe("Slug, used when id is not given"),
};

const writeSchema = {
  title: z.string().optional(),
  html: z.string().optional().describe("Full body as HTML; Ghost converts it to its native format"),
  status: z.enum(["draft", "published", "scheduled"]).optional(),
  published_at: z
    .string()
    .optional()
    .describe("ISO 8601 datetime; required when scheduling, optional to backdate"),
  tags: z.array(z.string()).optional().describe("Tag names; missing tags are created by Ghost"),
  featured: z.boolean().optional(),
  feature_image: z.string().optional().describe("URL of the feature image (use images_upload first for local/remote files)"),
  feature_image_alt: z.string().optional(),
  feature_image_caption: z.string().optional(),
  custom_excerpt: z.string().optional(),
  meta_title: z.string().optional().describe("SEO title (max 300 chars)"),
  meta_description: z.string().optional().describe("SEO description (max 500 chars)"),
  og_title: z.string().optional(),
  og_description: z.string().optional(),
  twitter_title: z.string().optional(),
  twitter_description: z.string().optional(),
  codeinjection_head: z.string().optional(),
  codeinjection_foot: z.string().optional(),
};

/** Build the payload Ghost expects: tag names -> {name} objects, drop undefined keys. */
function buildPayload(input: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    payload[k] = k === "tags" ? (v as string[]).map((name) => ({ name })) : v;
  }
  return payload;
}

/** Posts and pages share the same Admin API shape; register both resources from one definition. */
function registerContentTools(resource: "posts" | "pages") {
  const client = () => (api as any)[resource];
  const singular = resource.slice(0, -1);

  server.registerTool(
    `${resource}_browse`,
    {
      description: `List ${resource} (summaries only). Supports Ghost NQL filters and pagination.`,
      inputSchema: browseSchema,
    },
    async ({ limit, page, filter, order }) => {
      try {
        const res = await client().browse({ limit, page, filter, order, formats: "html" });
        return ok({
          [resource]: res.map(summarize),
          pagination: res.meta?.pagination,
        });
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    `${resource}_read`,
    {
      description: `Read a single ${singular} by id or slug, including its full HTML body.`,
      inputSchema: readSchema,
    },
    async ({ id, slug }) => {
      try {
        if (!id && !slug) return err(new Error("Provide id or slug"));
        const res = await client().read(id ? { id } : { slug }, { formats: "html" });
        return ok(res);
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    `${resource}_create`,
    {
      description: `Create a ${singular}. Defaults to draft unless status is set.`,
      inputSchema: { ...writeSchema, title: z.string().describe("Title (required)") },
    },
    async (input) => {
      try {
        const res = await client().add(buildPayload(input), { source: "html" });
        return ok(summarize(res));
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    `${resource}_update`,
    {
      description: `Update a ${singular}. Only the provided fields change; the body is replaced only when html is given. Handles Ghost's updated_at collision check automatically.`,
      inputSchema: { id: z.string(), ...writeSchema },
    },
    async ({ id, ...input }) => {
      try {
        // Ghost rejects edits without the current updated_at (collision detection).
        const current = await client().read({ id });
        const res = await client().edit(
          { id, updated_at: current.updated_at, ...buildPayload(input) },
          { source: "html" }
        );
        return ok(summarize(res));
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    `${resource}_delete`,
    {
      description: `Permanently delete a ${singular} by id. This cannot be undone.`,
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        await client().delete({ id });
        return ok({ deleted: id });
      } catch (e) {
        return err(e);
      }
    }
  );
}

registerContentTools("posts");
registerContentTools("pages");

server.registerTool(
  "tags_browse",
  {
    description: "List tags with post counts.",
    inputSchema: browseSchema,
  },
  async ({ limit, page, filter, order }) => {
    try {
      const res = await api.tags.browse({ limit, page, filter, order, include: "count.posts" });
      return ok({
        tags: res.map((t: any) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          description: t.description,
          post_count: t.count?.posts,
        })),
        pagination: res.meta?.pagination,
      });
    } catch (e) {
      return err(e);
    }
  }
);

server.registerTool(
  "tags_create",
  {
    description: "Create a tag.",
    inputSchema: {
      name: z.string(),
      slug: z.string().optional(),
      description: z.string().optional(),
      meta_title: z.string().optional(),
      meta_description: z.string().optional(),
    },
  },
  async (input) => {
    try {
      return ok(await api.tags.add(buildPayload(input)));
    } catch (e) {
      return err(e);
    }
  }
);

server.registerTool(
  "tags_update",
  {
    description: "Update a tag by id.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      slug: z.string().optional(),
      description: z.string().optional(),
      meta_title: z.string().optional(),
      meta_description: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    try {
      return ok(await api.tags.edit({ id, ...buildPayload(input) }));
    } catch (e) {
      return err(e);
    }
  }
);

server.registerTool(
  "tags_delete",
  {
    description: "Delete a tag by id. Posts keep their other tags.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      await api.tags.delete({ id });
      return ok({ deleted: id });
    } catch (e) {
      return err(e);
    }
  }
);

server.registerTool(
  "images_upload",
  {
    description:
      "Upload an image to Ghost from a remote URL or a local file path. Returns the Ghost-hosted URL to use as feature_image or in post HTML.",
    inputSchema: {
      url: z.string().optional().describe("Remote image URL to fetch and upload"),
      file_path: z.string().optional().describe("Local file path (when running locally)"),
    },
  },
  async ({ url, file_path }) => {
    if (!url && !file_path) return err(new Error("Provide url or file_path"));
    let tmpPath: string | undefined;
    try {
      const path = file_path ?? (tmpPath = await downloadToTmp(url!));
      const res = await api.images.upload({ file: path });
      return ok(res);
    } catch (e) {
      return err(e);
    } finally {
      if (tmpPath) await cleanupTmp(tmpPath);
    }
  }
);

server.registerTool(
  "site_info",
  {
    description: "Read basic site information (title, url, version).",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await api.site.read());
    } catch (e) {
      return err(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`ghost-admin-mcp connected to ${process.env.GHOST_API_URL}`);
