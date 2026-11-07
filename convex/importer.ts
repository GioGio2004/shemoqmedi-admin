import { ConvexError, v } from "convex/values";
import { action, internalMutation, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { award, creatorTier, region } from "./schema";
import { DAY_MS, LIMITS, VOTING_DAYS, isCategory, isTechnology } from "./lib/taxonomy";
import {
  EMPTY_SCORES,
  findOrCreateCreator,
  normalizeUrl,
  scoreFields,
  slugify,
  uniqueSlug,
} from "./lib/listingHelpers";
import { FLAGSHIP } from "./seed";

// ─────────────────────────────────────────────────────────────────────────────
// Microlink: title, description and a 1600×1000 screenshot for a URL.
// Free tier: ~50 requests/day. Set MICROLINK_API_KEY on the deployment for more.
// ─────────────────────────────────────────────────────────────────────────────

type Scraped = { title: string; description: string; screenshotUrl: string };

async function scrape(url: string): Promise<Scraped> {
  const key = process.env.MICROLINK_API_KEY;
  const api = new URL(key ? "https://pro.microlink.io/" : "https://api.microlink.io/");
  api.searchParams.set("url", url);
  api.searchParams.set("screenshot", "true");
  api.searchParams.set("meta", "true");
  api.searchParams.set("viewport.width", "1600");
  api.searchParams.set("viewport.height", "1000");
  api.searchParams.set("viewport.deviceScaleFactor", "1");
  api.searchParams.set("waitForTimeout", "1500");

  const res = await fetch(api, { headers: key ? { "x-api-key": key } : {} });
  const body = (await res.json().catch(() => null)) as {
    status?: string;
    message?: string;
    data?: { title?: string; description?: string; screenshot?: { url?: string } };
  } | null;
  if (!res.ok || body?.status !== "success" || !body.data?.screenshot?.url) {
    throw new Error(body?.message ?? `Microlink could not capture ${url} (HTTP ${res.status}).`);
  }
  return {
    title: body.data.title ?? "",
    description: body.data.description ?? "",
    screenshotUrl: body.data.screenshot.url,
  };
}

const importInput = v.object({
  url: v.string(),
  title: v.optional(v.string()), // overrides the scraped title
  tagline: v.optional(v.string()), // overrides the scraped description
  category: v.string(),
  technologies: v.array(v.string()),
  region,
  creatorTier,
  creditName: v.string(),
  creditUrl: v.optional(v.string()),
  location: v.optional(v.string()),
  // Lifecycle placement
  status: v.union(v.literal("pending"), v.literal("in_voting"), v.literal("awarded")),
  votingDaysLeft: v.optional(v.number()), // in_voting
  publishedDaysAgo: v.optional(v.number()), // awarded (>= 7)
  editorialScore: v.optional(v.number()), // same value on all 4 pillars
  awards: v.optional(v.array(award)),
  isClaimed: v.boolean(),
});

type ImportInput = typeof importInput.type;

const importResult = v.object({
  url: v.string(),
  ok: v.boolean(),
  id: v.optional(v.id("listings")),
  slug: v.optional(v.string()),
  skipped: v.optional(v.boolean()),
  error: v.optional(v.string()),
});

async function importOne(
  ctx: ActionCtx,
  input: ImportInput,
  source: "import" | "seed",
): Promise<typeof importResult.type> {
  try {
    const url = normalizeUrl(input.url);
    const scraped = await scrape(url);
    const image = await fetch(scraped.screenshotUrl);
    if (!image.ok) throw new Error(`Screenshot download failed (HTTP ${image.status}).`);
    const blob = await image.blob();
    const coverId = await ctx.storage.store(blob);
    const out: { id: Id<"listings">; slug: string; skipped: boolean } = await ctx.runMutation(
      internal.importer.insertImported,
      {
        ...input,
        url,
        title: input.title ?? scraped.title,
        tagline: input.tagline ?? scraped.description,
        coverId,
        source,
      },
    );
    return { url, ok: true, id: out.id, slug: out.slug, skipped: out.skipped };
  } catch (err) {
    const message =
      err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : String(err);
    return { url: input.url, ok: false, error: message };
  }
}

/** Admin: import up to 10 URLs (Microlink screenshot + meta) as listings. */
export const importUrls = action({
  args: {
    urls: v.array(v.string()),
    category: v.string(),
    technologies: v.array(v.string()),
    region,
    creatorTier,
    creditName: v.string(),
    creditUrl: v.optional(v.string()),
    publishNow: v.boolean(),
  },
  returns: v.array(importResult),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    const urls = [...new Set(args.urls.map((u) => u.trim()).filter(Boolean))];
    if (urls.length === 0) throw new ConvexError("Paste at least one URL.");
    if (urls.length > LIMITS.importBatch) {
      throw new ConvexError(`Import at most ${LIMITS.importBatch} URLs at a time.`);
    }
    const results = [];
    for (const url of urls) {
      results.push(
        await importOne(
          ctx,
          {
            url,
            category: args.category,
            technologies: args.technologies,
            region: args.region,
            creatorTier: args.creatorTier,
            creditName: args.creditName,
            creditUrl: args.creditUrl,
            status: args.publishNow ? "in_voting" : "pending",
            votingDaysLeft: args.publishNow ? VOTING_DAYS : undefined,
            isClaimed: false,
          },
          "import",
        ),
      );
    }
    return results;
  },
});

/** Admin: load the flagship seed listings (skips any that already exist). */
export const seedFlagship = action({
  args: {},
  returns: v.array(importResult),
  handler: async (ctx) => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    const results = [];
    for (const preset of FLAGSHIP) {
      const input: ImportInput = {
        ...preset,
        technologies: [...preset.technologies],
        awards: "awards" in preset ? [...preset.awards] : undefined,
      };
      results.push(await importOne(ctx, input, "seed"));
    }
    return results;
  },
});

export const insertImported = internalMutation({
  args: {
    ...importInput.fields,
    title: v.string(),
    tagline: v.string(),
    coverId: v.id("_storage"),
    source: v.union(v.literal("import"), v.literal("seed")),
  },
  returns: v.object({ id: v.id("listings"), slug: v.string(), skipped: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("listings")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .collect();
    const live = existing.find((l) => l.status !== "rejected");
    if (live) {
      await ctx.storage.delete(args.coverId);
      return { id: live._id, slug: live.slug, skipped: true };
    }

    const creditUrl = args.creditUrl?.trim()
      ? normalizeUrl(args.creditUrl, "Creator website")
      : undefined;
    const host = new URL(args.url).host.replace(/^www\./, "");
    const title = (args.title.trim() || host).slice(0, LIMITS.title);
    const tagline = args.tagline.trim().replace(/\s+/g, " ").slice(0, LIMITS.tagline);
    const category = isCategory(args.category) ? args.category : "other";
    const technologies = [...new Set(args.technologies)].filter(isTechnology).slice(0, LIMITS.technologies);

    const creatorId: Id<"creators"> = await findOrCreateCreator(ctx, {
      name: args.creditName.trim().slice(0, LIMITS.creditName),
      tier: args.creatorTier,
      region: args.region,
      website: creditUrl,
      location: args.location,
    });
    if (args.isClaimed) await ctx.db.patch(creatorId, { isClaimed: true });

    const now = Date.now();
    let publishedAt: number | undefined;
    let votingEndsAt: number | undefined;
    if (args.status === "in_voting") {
      const daysLeft = Math.min(Math.max(args.votingDaysLeft ?? VOTING_DAYS, 0.05), VOTING_DAYS);
      votingEndsAt = now + daysLeft * DAY_MS;
      publishedAt = votingEndsAt - VOTING_DAYS * DAY_MS;
    } else if (args.status === "awarded") {
      publishedAt = now - Math.max(args.publishedDaysAgo ?? VOTING_DAYS + 1, VOTING_DAYS + 1) * DAY_MS;
      votingEndsAt = publishedAt + VOTING_DAYS * DAY_MS;
    }

    const score = args.editorialScore;
    const editorialScores =
      score === undefined ? undefined : { design: score, usability: score, creativity: score, code: score };

    const slug = await uniqueSlug(ctx, "listings", slugify(title));
    const id = await ctx.db.insert("listings", {
      creatorId,
      source: args.source,
      submissionTier: "standard",
      slug,
      title,
      tagline,
      url: args.url,
      category,
      technologies,
      region: args.region,
      creatorTier: args.creatorTier,
      creditName: args.creditName,
      creditUrl,
      coverId: args.coverId,
      status: args.status,
      publishedAt,
      votingEndsAt,
      ...EMPTY_SCORES,
      editorialScores,
      ...scoreFields(editorialScores, EMPTY_SCORES.communityTotals, 0),
      awards: args.status === "awarded" ? (args.awards ?? []) : [],
      awardedAt: args.status === "awarded" ? votingEndsAt : undefined,
      isClaimed: args.isClaimed,
      createdAt: now,
      updatedAt: now,
    });
    return { id, slug, skipped: false };
  },
});
