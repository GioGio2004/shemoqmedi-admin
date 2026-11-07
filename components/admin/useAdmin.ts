"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export type AdminState =
  | { kind: "loading" }
  | { kind: "no-session" }
  | { kind: "not-synced" }
  | { kind: "forbidden"; email: string }
  | { kind: "admin" };

/** Who is looking at the admin, without ever calling admin-only queries early. */
export function useAdmin(): AdminState {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");

  if (isLoading) return { kind: "loading" };
  if (!isAuthenticated) return { kind: "no-session" };
  if (me === undefined) return { kind: "loading" };
  if (me === null) return { kind: "not-synced" };
  if (me.role !== "admin" && me.role !== "super_admin") {
    return { kind: "forbidden", email: me.email };
  }
  return { kind: "admin" };
}
