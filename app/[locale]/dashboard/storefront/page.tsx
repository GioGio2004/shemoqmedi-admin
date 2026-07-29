import type { Metadata } from "next";
import { WorkspaceClient } from "./_components/WorkspaceClient";

export const metadata: Metadata = {
  title: "Storefront Studio — Shemoqmedi",
  description:
    "Design your venue's menu and manage its storefront — one workspace.",
};

// The dashboard layout renders this route full-bleed (no container, no
// sidebar) — the workspace brings its own chrome, preview stage and mobile
// bottom navigation.
export default function StorefrontPage() {
  return <WorkspaceClient />;
}
