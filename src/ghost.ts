import GhostAdminAPI from "@tryghost/admin-api";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const url = process.env.GHOST_API_URL;
const key = process.env.GHOST_ADMIN_API_KEY;

if (!url || !key) {
  console.error(
    "Missing required environment variables: GHOST_API_URL (e.g. https://blog.example.com) and GHOST_ADMIN_API_KEY (Admin API key in id:secret format)"
  );
  process.exit(1);
}

export const api = new GhostAdminAPI({
  url: url.replace(/\/$/, ""),
  key,
  version: process.env.GHOST_API_VERSION ?? "v5.0",
});

/** Download a remote image to a temp file so the Admin API client can upload it. Returns the temp path; caller must clean up. */
export async function downloadToTmp(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${imageUrl}: HTTP ${res.status}`);
  }
  const ext = extname(new URL(imageUrl).pathname) || ".jpg";
  const tmpPath = join(tmpdir(), `ghost-mcp-upload-${process.pid}-${Date.now()}${ext}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmpPath));
  return tmpPath;
}

export async function cleanupTmp(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}
