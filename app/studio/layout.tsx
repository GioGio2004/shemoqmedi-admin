import type { Metadata } from "next";
import { connection } from "next/server";
import { StudioShell } from "@/components/studio/StudioShell";
import "./studio.css";

// The Studio (studio.shemoqmedi.space): proxy.ts rewrites /x on the Studio
// host to /studio/x, and this tree serves it. Every page is rendered per
// request (never prerendered), so the rewritten address can't disagree with
// a prerendered one. proxy.ts requires a session; StudioShell checks the
// admin role before any page mounts.

export const metadata: Metadata = {
  title: { default: "Studio | Shemoqmedi", template: "%s | Studio" },
  description: "Design, schedule and publish Shemoqmedi's posts, stories and reels.",
  appleWebApp: { capable: true, title: "Studio", statusBarStyle: "default" },
};

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return <StudioShell>{children}</StudioShell>;
}
