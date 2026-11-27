import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

// Who may read the team docs. The docs hold internal detail (how awards are
// decided, admin flows, weak spots), so every page checks this on the server
// before rendering any of its text: a visitor without the role gets the
// "no access" page and nothing else in the HTML or the RSC payload.
//
// One list so a future "team" role (read the docs, no admin powers) is a
// one-line change here plus the role in convex/schema.ts.
export const DOCS_ROLES = ["admin", "super_admin"] as const;

export type DocsViewer =
  | { status: "ok"; name: string | null; role: string }
  | { status: "signed-out" }
  | { status: "forbidden"; name: string | null };

/**
 * A Convex client signed in as the current viewer (once per request), or null
 * when signed out. A client per request: a shared one would carry one user's
 * token into another's request.
 */
export const getDocsConvex = cache(async (): Promise<ConvexHttpClient | null> => {
  const { userId, getToken } = await auth();
  if (!userId) return null;
  const token = await getToken({ template: "convex" });
  if (!token) return null;
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);
  return client;
});

/** The current viewer's access to the docs (once per request). */
export const getDocsViewer = cache(async (): Promise<DocsViewer> => {
  const client = await getDocsConvex();
  if (!client) return { status: "signed-out" };
  const user = await client.query(api.users.getCurrentUser, {}).catch(() => null);
  const name = user?.name ?? null;
  const role = user?.role;
  if (role && (DOCS_ROLES as readonly string[]).includes(role)) return { status: "ok", name, role };
  return { status: "forbidden", name };
});
