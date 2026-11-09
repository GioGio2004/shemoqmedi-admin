import { ConvexError, v } from "convex/values";
import { deleteMedia, vMediaId } from "./lib/media";
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
import { grantAward } from "./lib/awards";
import { domainKey } from "./lib/domains";
import { tbilisiDay, tbilisiMonth, tbilisiYear, weekOf } from "./lib/time";
import { uploadToImageKitFromServer } from "./lib/imagekitServer";

// ─────────────────────────────────────────────────────────────────────────────
// Capture: title + description + a desktop screenshot for a URL.
//
// Screenshot providers, tried in order until one returns an image:
//   1. Microlink (1600×1000). Free tier is ~50/day and is shared per IP, so
//      from Convex's cloud it is often exhausted; MICROLINK_API_KEY fixes that.
//   2. thum.io (1600px wide, no key, no watermark).
//   3. WordPress mShots (1280×960, no key; generates on first request, so poll).
// Title and description come from Microlink's metadata when it worked, else
// from the page's own <title> / meta description.
// ─────────────────────────────────────────────────────────────────────────────

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Meta = { title: string; description: string };
type Capture = Meta & { image: Blob; provider: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function asImage(res: Response): Promise<Blob | null> {
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/") || type.includes("gif")) return null;
  const blob = await res.blob();
  return blob.size > 5_000 ? blob : null; // tiny images are placeholders
}

async function viaMicrolink(url: string): Promise<(Meta & { image: Blob }) | null> {
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
    data?: { title?: string; description?: string; screenshot?: { url?: string } };
  } | null;
  const shot = body?.status === "success" ? body.data?.screenshot?.url : undefined;
  if (!shot) return null;
  const image = await asImage(await fetch(shot));
  if (!image) return null;
  return { title: body?.data?.title ?? "", description: body?.data?.description ?? "", image };
}

async function viaThum(url: string): Promise<Blob | null> {
  return asImage(
    await fetch(`https://image.thum.io/get/width/1600/crop/1000/noanimate/${url}`, {
      headers: { "user-agent": BROWSER_UA },
    }),
  );
}

async function viaMshots(url: string): Promise<Blob | null> {
  const api = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=1600&h=1000`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const image = await asImage(await fetch(api, { headers: { "user-agent": BROWSER_UA } }));
    if (image) return image;
    await sleep(5000); // still generating
  }
  return null;
}

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** <title> / og:title and meta description / og:description from the page itself. */
async function pageMeta(url: string): Promise<Meta> {
  try {
    const res = await fetch(url, { headers: { "user-agent": BROWSER_UA, accept: "text/html" } });
    const html = (await res.text()).slice(0, 300_000);
    const metaContent = (name: string) => {
      const a = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
      const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i");
      return html.match(a)?.[1] ?? html.match(b)?.[1] ?? "";
    };
    const title = metaContent("og:title") || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "";
    const description = metaContent("description") || metaContent("og:description");
    return { title: decodeEntities(title), description: decodeEntities(description) };
  } catch {
    return { title: "", description: "" };
  }
}

async function capture(url: string): Promise<Capture> {
  const micro = await viaMicrolink(url).catch(() => null);
  if (micro) return { ...micro, provider: "microlink" };

  const meta = await pageMeta(url);
  const thum = await viaThum(url).catch(() => null);
  if (thum) return { ...meta, image: thum, provider: "thum.io" };
  const mshots = await viaMshots(url).catch(() => null);
  if (mshots) return { ...meta, image: mshots, provider: "mshots" };

  throw new ConvexError(
    `Couldn't capture a screenshot of ${url}. The site may block screenshot services; try again later or set MICROLINK_API_KEY.`,
  );
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
  byTeam: v.optional(v.boolean()), // Shemoqmedi team site: never awarded
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
    const scraped = await capture(url);
    // Straight to ImageKit (never Convex storage), SEO-named like browser uploads.
    const slug = slugify(input.title ?? scraped.title ?? new URL(url).host);
    const type = scraped.image.type || "image/jpeg";
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const file = await uploadToImageKitFromServer(scraped.image, {
      fileName: `${slug}-website-cover.${ext}`,
      folder: `/listings/${slug}`,
      tags: ["listing", slug, "image", "import"],
    });
    const coverId: Id<"media"> = await ctx.runMutation(internal.media.registerInternal, {
      fileId: file.fileId,
      url: file.url,
      filePath: file.filePath,
      kind: "image",
      contentType: type,
      size: file.size,
      width: file.width,
      height: file.height,
    });
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
        awards: "awards" in preset && Array.isArray(preset.awards) ? [...(preset.awards as ImportInput["awards"] & object)] : undefined,
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
    coverId: vMediaId,
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
      await deleteMedia(ctx, args.coverId);
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
      score === undefined ? undefined : { design: score, usability: score, creativity: score, content: score };
    const picked = args.status === "awarded" ? [...new Set(args.awards ?? [])] : [];

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
      // Awarded: created closed; each award then goes through the award rules (logged).
      status: args.status === "awarded" ? "archived" : args.status,
      batchWeek: args.status === "in_voting" ? weekOf(now) : undefined,
      domainKey: domainKey(args.url),
      byTeam: args.byTeam || undefined,
      publishedAt,
      votingEndsAt,
      ...EMPTY_SCORES,
      editorialScores,
      ...scoreFields(editorialScores, EMPTY_SCORES.communityTotals, 0),
      awards: [],
      isClaimed: args.isClaimed,
      createdAt: now,
      updatedAt: now,
    });
    for (const tier of args.byTeam ? [] : picked) {
      await grantAward(ctx, {
        listingId: id,
        tier,
        period: tier === "SOTM" ? tbilisiMonth(now) : tier === "SOTY" ? tbilisiYear(now) : tbilisiDay(now),
        score: score ?? null,
        now,
        source: "manual",
        reason: `Imported with this award (${args.source}).`,
      });
    }
    return { id, slug, skipped: false };
  },
});
