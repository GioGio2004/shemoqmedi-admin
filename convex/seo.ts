// IndexNow: tells Bing (and through it DuckDuckGo, Ecosia, Copilot), Yandex,
// Seznam, Naver and Yep about a minute after a public page changes. Google ignores
// IndexNow and reads the sitemap instead.
//
// Setup (production deployment only):
//   npx convex env set INDEXNOW_KEY <8-128 letters, digits or dashes> --prod
//   npx convex env set SITE_URL https://www.shemoqmedi.space --prod   (optional, this is the default)
// and serve the same key as plain text at <SITE_URL>/<key>.txt on the site.
// Without INDEXNOW_KEY (dev, previews, tests) nothing is scheduled or sent.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const ENDPOINT = "https://api.indexnow.org/indexnow";
const DEFAULT_SITE_URL = "https://www.shemoqmedi.space";
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const MAX_URLS = 10_000; // IndexNow's limit per request

/**
 * The site's pages are ISR (`revalidate = 60`): after a change, the first
 * request still gets the stale copy while the page rebuilds in the background.
 * A crawler sent by an immediate ping is often that first request, so it would
 * see the old page instead of the new one, the 404 or the 308. The ping waits
 * out that window, requests each page once (which rebuilds it), then pings.
 */
const SITE_REVALIDATE_MS = 60_000;
export const PING_DELAY_MS = SITE_REVALIDATE_MS + 15_000;
const MAX_WARM_URLS = 50;

function indexNowKey() {
  return process.env.INDEXNOW_KEY?.trim() || null;
}

function siteUrl() {
  return (process.env.SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Site paths
// ─────────────────────────────────────────────────────────────────────────────

export const sitePath = (slug: string) => `/sites/${slug}`;
export const creatorPath = (slug: string) => `/creators/${slug}`;

/** The award collection pages (/collections/sotd, /bsc, /hm). */
export function awardPaths(awards: readonly string[]) {
  return awards.map((a) => `/collections/${a.toLowerCase()}`);
}

/** /sites/<slug> and, when the listing has one, its creator page. */
export async function listingPaths(
  ctx: QueryCtx,
  listing: Pick<Doc<"listings">, "slug" | "creatorId">,
): Promise<string[]> {
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  return creator ? [sitePath(listing.slug), creatorPath(creator.slug)] : [sitePath(listing.slug)];
}

/**
 * Queue one IndexNow ping for these site paths (call it once per mutation).
 * Empty entries are skipped; does nothing when INDEXNOW_KEY is not set.
 */
export async function scheduleIndexNow(
  ctx: MutationCtx,
  paths: (string | null | undefined | false)[],
): Promise<void> {
  if (!indexNowKey()) return;
  const unique = [...new Set(paths.filter((p): p is string => typeof p === "string" && p.startsWith("/")))];
  if (unique.length === 0) return;
  await ctx.scheduler.runAfter(PING_DELAY_MS, internal.seo.pingIndexNow, { paths: unique });
}

// ─────────────────────────────────────────────────────────────────────────────
// The ping
// ─────────────────────────────────────────────────────────────────────────────

/** POSTs the URLs to IndexNow. Never throws: failures are only logged. */
export const pingIndexNow = internalAction({
  args: { paths: v.array(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { paths }) => {
    const key = indexNowKey();
    if (!key) return null;
    try {
      if (!KEY_PATTERN.test(key)) {
        console.error("IndexNow: INDEXNOW_KEY must be 8-128 letters, digits or dashes. Nothing sent.");
        return null;
      }
      const origin = siteUrl();
      const host = new URL(origin).host;
      const urlList = [...new Set(paths.filter((p) => p.startsWith("/")).map((p) => `${origin}${p}`))].slice(
        0,
        MAX_URLS,
      );
      if (urlList.length === 0) return null;
      // Rebuild the stale ISR copies first (see PING_DELAY_MS). Failures don't matter.
      await Promise.allSettled(
        urlList.slice(0, MAX_WARM_URLS).map(async (url) => {
          const page = await fetch(url);
          await page.body?.cancel();
        }),
      );
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
      });
      if (res.ok) {
        console.log(`IndexNow: sent ${urlList.length} URL(s), HTTP ${res.status}.`);
      } else {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        console.error(`IndexNow: HTTP ${res.status} for ${urlList.join(", ")}. ${detail}`);
      }
    } catch (err) {
      console.error("IndexNow: ping failed.", err);
    }
    return null;
  },
});
