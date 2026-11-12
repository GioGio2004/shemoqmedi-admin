// Who an MCP request acts for. Giorgi signs in with his Shemoqmedi account
// (Clerk OAuth) in Claude; the admin app checks that access token and sends
// `token`, a short-lived credential naming the Clerk user, signed with
// MCP_SERVICE_SECRET (lib/tokens.ts). Only platform admins get the tools,
// the same rule as requireAdmin (authHelpers.ts).

import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getUserByExternalId } from "../users";
import { verifyServiceCredential } from "./tokens";

export async function adminFromToken(ctx: QueryCtx, token: string): Promise<Doc<"users"> | null> {
  const clerkUserId = await verifyServiceCredential(token);
  if (clerkUserId === null) return null;
  const user = await getUserByExternalId(ctx, clerkUserId);
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) return null;
  return user;
}

export async function requireTokenAdmin(ctx: QueryCtx, token: string): Promise<Doc<"users">> {
  const user = await adminFromToken(ctx, token);
  if (user === null) {
    throw new ConvexError("Not signed in to Shemoqmedi as an admin. Reconnect the Shemoqmedi connector and sign in again.");
  }
  return user;
}
