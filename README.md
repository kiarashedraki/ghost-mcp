# ghost-admin-mcp

An MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for the [Ghost Admin API](https://ghost.org/docs/admin-api/). Lets any MCP client — Claude, Cursor, obot, etc. — manage a Ghost blog: create and edit posts and pages, manage tags, and upload images.

Unlike Content-API wrappers, this uses the **Admin API**, so it can write, not just read.

## Tools

| Tool | Description |
|---|---|
| `posts_browse` / `posts_read` | List post summaries (NQL filters, pagination) / read one with full HTML |
| `posts_create` / `posts_update` / `posts_delete` | Full write access, including SEO meta, tags, feature image, scheduling |
| `pages_browse` / `pages_read` / `pages_create` / `pages_update` / `pages_delete` | Same, for pages |
| `tags_browse` / `tags_create` / `tags_update` / `tags_delete` | Tag management with post counts |
| `images_upload` | Upload from a remote URL or local path; returns the Ghost-hosted URL |
| `site_info` | Site title, url, Ghost version |

Niceties handled for you:

- **`updated_at` collision check** — updates fetch the current value first, so you never see `Saving failed! Someone else is editing this post.`
- **HTML source** — write bodies as plain HTML; Ghost converts to its native format (`?source=html`).
- **Tags by name** — pass `["Recipes", "Dinner"]`; unknown tags are created automatically.

## Setup

1. In Ghost Admin: **Settings → Integrations → Add custom integration** — copy the **Admin API Key** (`id:secret` format) and your site URL.
2. Configure your MCP client:

```json
{
  "mcpServers": {
    "ghost": {
      "command": "npx",
      "args": ["-y", "ghost-admin-mcp"],
      "env": {
        "GHOST_API_URL": "https://your-blog.com",
        "GHOST_ADMIN_API_KEY": "abc123:def456..."
      }
    }
  }
}
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GHOST_API_URL` | yes | Your Ghost site URL, no trailing slash needed |
| `GHOST_ADMIN_API_KEY` | yes | Admin API key (`id:secret`) from a custom integration |
| `GHOST_API_VERSION` | no | API version header, default `v5.0` (works with Ghost 5.x and 6.x) |

### Docker

```bash
docker build -t ghost-admin-mcp .
docker run -e GHOST_API_URL=... -e GHOST_ADMIN_API_KEY=... ghost-admin-mcp
```

The container speaks MCP over stdio; use your platform's stdio wrapper (e.g. obot's containerized runtime) to expose it over HTTP.

## Development

```bash
npm install
npm run build
GHOST_API_URL=... GHOST_ADMIN_API_KEY=... node dist/index.js
```

## License

MIT
