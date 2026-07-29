import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";

// ─────────────────────────────────────────────────────────────────────────────
// authedConvexClient — a PER-REQUEST Convex client carrying the caller's
// Clerk token, for use inside Next route handlers.
//
// Two rules this encodes:
//  1. Never share one ConvexHttpClient across requests and call setAuth on it —
//     a module-level singleton leaks one user's token into another's request.
//  2. Convex functions must authenticate themselves. Verifying at the route
//     layer only protects the route; the Convex endpoint stays world-callable.
//
// "convex" is the Clerk JWT template name — it must match `applicationID`
// in convex/auth.config.ts.
// ─────────────────────────────────────────────────────────────────────────────
export async function authedConvexClient(): Promise<
  { client: ConvexHttpClient; userId: string; orgId: string | null } | null
> {
  const { userId, orgId, getToken } = await auth();
  if (!userId) return null;

  const token = await getToken({ template: "convex" });
  if (!token) return null;

  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);
  return { client, userId, orgId: orgId ?? null };
}
