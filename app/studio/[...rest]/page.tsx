import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Every Studio address that isn't a Studio page (proxy.ts rewrites any path
// on the Studio host to /studio/<path>). A segment's not-found.js renders only
// for notFound() (an unmatched URL would get Next's bare default 404, outside
// the Studio's frame), so this catch-all calls it: app/studio/not-found.tsx
// then shows inside StudioShell, with the tab bar and a way home. The real
// pages (create, queue, reels, reminders) are static segments and win over it.

export const metadata: Metadata = { title: "Not found" };

export default function StudioUnknownPage(): never {
  notFound();
}
