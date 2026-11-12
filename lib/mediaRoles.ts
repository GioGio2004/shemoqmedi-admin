// What a stored media row is used for (convex/mcp.ts roleOf). Shared by the
// Convex query (list_media) and the MCP tool schema (lib/mcp/server.ts), so
// the two can't drift. Plain data: safe to import from Convex and Next.

export const MEDIA_ROLES = ["graphic", "carousel", "reel", "screenshot", "preview", "other"] as const;

export type MediaRole = (typeof MEDIA_ROLES)[number];
