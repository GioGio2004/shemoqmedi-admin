import { headerAuthHandler } from "@/lib/mcp/server";

/**
 * The social desk connector. Clients sign in with Shemoqmedi (OAuth via Clerk,
 * see lib/mcp/oauth.ts); only admins get the tools. The server itself lives
 * in lib/mcp/server.ts, its backend in convex/mcp.ts.
 */

export const dynamic = "force-dynamic";
// render_carousel renders and uploads 6-8 slides in one tool call; 300 s is
// the Hobby maximum with Fluid compute (Vercel's default), so a slow render
// still returns its URLs instead of timing out while Convex finishes the work.
export const maxDuration = 300;

export { headerAuthHandler as GET, headerAuthHandler as POST, headerAuthHandler as DELETE };
