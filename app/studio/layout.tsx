import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { StudioShell } from "@/components/studio/StudioShell";
import { THEME_BG, THEME_SCRIPT } from "@/components/studio/themeScript";
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

// The browser chrome takes the Studio's background, light or dark.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_BG.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_BG.dark },
  ],
  viewportFit: "cover",
};

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <>
      {/* The Light / Dark choice goes on <html> before the first paint, so there is no flash of the other theme. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <StudioShell>{children}</StudioShell>
    </>
  );
}
