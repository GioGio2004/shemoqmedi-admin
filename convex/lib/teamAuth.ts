import type { QueryCtx } from "../_generated/server";
import { requireAdmin } from "../authHelpers";
import { requireTokenAdmin } from "./mcpAuth";

// Team guides and tasks (convex/guides.ts, convex/tasks.ts) are used from the
// admin (a signed-in browser session) and from the Shemoqmedi MCP connector
// (a short-lived signed credential, lib/mcp/server.ts). Both must be a
// platform admin; this picks the check by what the call carries.

/** The acting admin: from the connector's `token` when given, else the signed-in session. */
export async function teamAdmin(ctx: QueryCtx, token: string | undefined) {
  return token === undefined ? await requireAdmin(ctx) : await requireTokenAdmin(ctx, token);
}
