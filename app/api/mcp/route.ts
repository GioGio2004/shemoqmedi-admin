import { headerAuthHandler } from "@/lib/mcp/server";

/**
 * The social desk connector. Clients sign in with Shemoqmedi (OAuth via Clerk,
 * see lib/mcp/oauth.ts); only admins get the tools. The server itself lives
 * in lib/mcp/server.ts, its backend in convex/mcp.ts.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export { headerAuthHandler as GET, headerAuthHandler as POST, headerAuthHandler as DELETE };
