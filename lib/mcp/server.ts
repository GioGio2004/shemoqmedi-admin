import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { THREADS_MAX, threadsLength } from "@/convex/lib/socialApi";
import type { Id } from "@/convex/_generated/dataModel";
import { publicOrigin, serviceCredential, verifyOAuthToken } from "./oauth";
import {
  FORMAT_ENUM,
  MEDIA_ROLE_ENUM,
  PALETTE_DESCRIPTION,
  STYLE_DESCRIPTION,
  STYLE_ENUM,
  TEMPLATE_ENUM,
  paletteCatalog,
  styleCatalog,
  templateCatalog,
} from "./catalog";

/**
 * The Shemoqmedi social desk connector: Giorgi's own Claude (the Claude app on
 * his phone, claude.ai or Claude Code) reads listings, awards and studios,
 * renders graphics and voiceovers, writes and approves social posts (approval
 * publishes them to Facebook, Instagram, Threads and LinkedIn), and emails
 * studios. Admins only. Access tokens of the networks never reach this app.
 *
 * Auth on /api/mcp is "Sign in with Shemoqmedi": OAuth through Clerk (see
 * oauth.ts). Every tool is a Convex function in convex/mcp.ts that checks the
 * short-lived credential minted here and requires the admin role.
 *
 * Built on Kalami's connector (kalami/lib/mcp/server.ts).
 */

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
}
const convex = new ConvexHttpClient(convexUrl);

// --- Helpers -----------------------------------------------------------------

function text(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

function failure(error: unknown): CallToolResult {
  let message = "Something went wrong.";
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string") message = data;
    else if (typeof data === "object" && data !== null && "message" in data) message = String((data as { message: unknown }).message);
  } else if (error instanceof Error) {
    // Convex wraps thrown errors as "[Request ID: …] Server Error\nUncaught Error: <message> …".
    const m = /Uncaught (?:ConvexError|Error): ([^\n]+)/.exec(error.message);
    message = m ? m[1] : error.message;
  }
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Runs a Convex call for a tool and turns its errors into tool errors. */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return text(await fn());
  } catch (error) {
    return failure(error);
  }
}

type ToolContext = { http?: { authInfo?: AuthInfo } };

function auth(ctx: ToolContext) {
  const token = ctx.http?.authInfo?.token;
  if (!token) {
    throw new Error("Missing access token");
  }
  return { token };
}

/** "2026-11-14T18:00" (Tbilisi when no offset is given) → epoch ms; null clears; undefined keeps. */
function parseWhen(value: string | null | undefined): number | null | undefined {
  if (value === undefined || value === null) return value;
  const hasZone = /([zZ]|[+-]\d\d:?\d\d)$/.test(value);
  const ms = Date.parse(hasZone ? value : `${value}+04:00`);
  if (Number.isNaN(ms)) throw new Error(`"${value}" is not a date and time. Use e.g. 2026-11-14T18:00 (Tbilisi time).`);
  return ms;
}

const INSTRUCTIONS = `You are connected to Shemoqmedi (shemoqmedi.space), an awards site for web design run by Giorgi, as his social media and outreach desk. He is the only person running it, so your job is to do the work and bring him finished things to approve.

What the database does by itself: when an award is announced (Honorable Mention, Site of the Day, Site of the Month, Site of the Year), when a site goes public (new listing), every Monday (call for submissions), every other Thursday (call for jurors) and on Sundays (weekly roundup), it queues a social post with \`facts\`: plain data about the site, studio, award, screenshots and links. Award winners and featured studios are emailed by the system.

Your daily loop when Giorgi asks "what's waiting?":
1. social_queue (status waiting). For each post read its facts (get_post; get_listing for jury comments and more).
2. Make the graphics. Always attach graphics, not only screenshots. For award and new-listing posts render the storytelling carousel (render_carousel with the listing's slug) and use its slides for Instagram, Facebook and LinkedIn (media items with networks ["instagram","facebook","linkedin"]); add the carousel's first (hook) slide once more with networks ["threads"] for Threads. For calls, roundups and announcements render one graphic (render_graphic) in ig_portrait or square: Instagram only takes images between 4:5 and 1.91:1, so story, reel_cover and link graphics get padded with white for Instagram (keep those for other networks via the media item's networks). Pick a style for each post (list_styles): glass is the frosted look over a blurred backdrop of the site; swiss, kinetic, magazine and bento are flat and render fast. Keep one style across a post's slides and vary styles between posts so the feed doesn't repeat itself; pass the same style to render_graphic and render_carousel. A preview video can go first instead when Giorgi wants a reel (voiceovers: list_voices, create_voiceover, then he builds the reel on the Studio's Reels page).
3. Write captions for the networks that fit: instagram, facebook, threads, linkedin. Save captions and media with update_post.
4. Show him every caption in full and the rendered image URLs it will use, then ask. Only call approve_post after he says yes to that exact post. If he asks for changes, edit and show again.
5. Approving publishes: at once, or at the post's publish time (publishAt), to every network that has a caption and a connected account. publish_post does it in one step (now, or at a time Giorgi gives); unschedule_post takes a scheduled post back to waiting. Check list_channels when unsure what is connected. Afterwards get_post shows each network's result and link; a failed network can be sent again with retry_post (networks already sent are never sent twice).

Editing a drafted post (Giorgi asks to change a post you or he made, e.g. "make the graphic darker", "change the headline", "swap the second slide"): never start over and never publish while editing.
1. get_post. Its mediaDetails[i] describes media[i]: size and design, the recipe the graphic was rendered from (null for screenshots, uploads and renders made before recipes were kept). get_designs reads the recipe of any URL, e.g. from list_media.
2. Change the recipe and render again with the same inputs plus the change. design.kind "graphic": render_graphic with its template, format, style, palette, glass, fields and imageUrls. design.kind "carousel": render_carousel with listingSlug (design.listingSlug), facts, palette, style and story; it renders the whole set again (a carousel's slides share design.setId; design.slideIndex is the slide's place in it). When design is null, rebuild it as best you can from the post's facts (template from the post kind, the listing's screenshot as the image) and tell Giorgi it is a redesign.
3. update_post with the whole media list: the new URL in place of the old item (keep its role and networks), or the carousel's new slides in place of the old set (and the new hook slide for Threads). Keep every other item as it was. Captions stay unless he asked to change them.
4. Show him the new image URLs and ask again. Editing an approved, scheduled or failed post sends it back to waiting (a scheduled publish is cancelled): say so before you change one, and only approve or publish after he says yes again.

Stories: a post with placement "story" (set on create_post or update_post) is exactly one 9:16 image (render_graphic with format story, in any style) or video (find_reel finds a listing's latest reel). It goes to Instagram and the Facebook Page as a story; Threads and LinkedIn have no stories and are skipped. Stories show no text, so a short caption for instagram and/or facebook only picks where it goes. list_templates, list_palettes, list_styles and list_media help pick and reuse graphics.

Voice and rules:
- English only. Short, specific and warm; say what is good about the site in concrete terms (motion, typography, the idea). No hype words ("stunning", "game-changer", "mind-blowing"), no emoji walls (one or two at most), no engagement bait.
- Always credit the studio. Tag them with their handle from facts.studio.socials for that network (Instagram/Facebook "@handle"; LinkedIn mention the studio name and link their site). If there's no handle, use the studio name and offer to look the handle up (then save it with update_creator).
- Instagram: needs an image or video (the post's media); caption up to ~1,000 characters, line breaks between ideas, the link goes "in bio" or on the award page, 3–5 relevant hashtags at the end (#webdesign #awwwards-style tags are fine, #shemoqmedi always).
- Facebook: conversational, 1–3 short paragraphs, include the page link (facts.pageUrl or the award pageUrl).
- Threads: 500 characters at most as Threads counts them: every emoji counts as 2-4 (🏆 = 4, ✨ = 3, ➡️ = 6), so keep emoji few and stay well under 500 (the tool refuses longer). Conversational, like talking to people, one idea, a question is welcome; the link in the text; at most one topic tag (#webdesign style), no hashtag walls.
- LinkedIn: posted from Giorgi's personal profile, so write in first person as him (founder of Shemoqmedi), a bit more reflective, include the link, 0–3 hashtags. Write plain text; the system escapes LinkedIn's special characters.
- Award posts lead with the award and the site; new-listing posts say it's in this week's jury vote; calls invite people with the submit or jury link; roundups list the week's sites and awards.
- Never invent facts (scores, dates, people, quotes). Jury comments from get_listing may be quoted with the juror's name.

Email:
- preview_email shows exactly what will be sent; send_email sends it and needs confirm: true, which you may only set after Giorgi approved that preview. Use {claimLink} in the body to include an unclaimed listing's claim link.
- For outreach to studios that aren't in the database yet, find their public contact email on their own website, write a short personal note (who we are, why their work, one clear ask), show it, and send only after a yes. Save emails you find with update_creator.
- Broadcasts (preview_broadcast, send_broadcast) go to many people: always show the recipient count and the full text first; confirm only after an explicit yes.
- Never message people on LinkedIn or other networks automatically; for LinkedIn, write the message and Giorgi sends it himself.

Times are Tbilisi time (UTC+4) unless Giorgi says otherwise.`;

const slug = z.string().min(1).max(80);
const postId = z.string().describe("Post id from social_queue");
const network = z.enum(["facebook", "instagram", "threads", "linkedin"]);
const captions = z
  .object({
    instagram: z.string().max(2200).optional(),
    facebook: z.string().max(3000).optional(),
    threads: z
      .string()
      .max(THREADS_MAX)
      .refine((s) => threadsLength(s.trim()) <= THREADS_MAX, {
        message: `Threads allows ${THREADS_MAX} characters, and counts every emoji as 2-4 (🏆 = 4, ✨ = 3): shorten the text or drop emoji.`,
      })
      .optional()
      .describe("Threads: 500 characters at most, every emoji counting as 2-4 (🏆 = 4, ✨ = 3); at most one topic tag"),
    linkedin: z.string().max(3000).optional(),
  })
  .describe('Captions per network; "" removes one. Every network with a caption is published on approval.');
const media = z
  .array(
    z.object({
      kind: z.enum(["image", "video"]),
      url: z.string().url().describe("Public https URL"),
      role: z.string().max(40).optional().describe('e.g. "screenshot", "graphic", "carousel", "hook", "voiceover"'),
      networks: z
        .array(network)
        .optional()
        .describe('Only on these networks (absent = all). E.g. carousel slides ["instagram","facebook","linkedin"], the hook slide ["threads"].'),
    }),
  )
  .max(10)
  .describe(
    "The post's images/videos in order (carousel order). Replaces the current list. The first item decides each network's post: a video makes a video post (Instagram reel), images make a photo/carousel post.",
  );
const palette = z.string().describe(PALETTE_DESCRIPTION);
const placement = z
  .enum(["feed", "story"])
  .describe('"story": one 9:16 image or video, posted as an Instagram and Facebook story (Threads and LinkedIn are skipped). Default feed.');
const when = z.string().describe("ISO date-time, Tbilisi time when no offset, e.g. 2026-11-14T18:00");
const glass = z.enum(["frost", "liquid", "tint"]).optional().describe("Glass finish for the glass style (default frost)");
const style = z.enum(STYLE_ENUM).optional().describe(STYLE_DESCRIPTION);
const audience = z
  .enum(["users", "studios", "jurors", "all"])
  .describe("users: everyone with an account; studios: studio contact emails and owners; jurors: active jurors; all: everyone");

// --- The server --------------------------------------------------------------

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "whoami",
      { title: "Who am I", description: "The signed-in Shemoqmedi admin.", inputSchema: z.object({}) },
      async (_args, ctx) => run(() => convex.query(api.mcp.whoami, auth(ctx))),
    );

    server.registerTool(
      "stats",
      {
        title: "Desk stats",
        description: "Counts: social posts by status, emails in the last 30 days, listings by status, creators with contact emails, opt-outs.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) => run(() => convex.query(api.mcp.stats, auth(ctx))),
    );

    // Listings, awards, studios

    server.registerTool(
      "search_listings",
      {
        title: "Search listings",
        description: "Listings (sites) newest first, optionally filtered by text (title, studio, slug, URL) and status. Returns slugs for get_listing.",
        inputSchema: z.object({
          text: z.string().max(100).optional(),
          status: z.enum(["pending", "in_voting", "awarded", "archived", "rejected"]).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.searchListings, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "get_listing",
      {
        title: "Get listing",
        description:
          "Everything about a site: title, tagline, URLs, studio (with social handles), categories, technologies, jury note and every juror's scores and comment, awards, screenshots and video URLs, and private details (studio contact email, owner, claim link), plus its social posts and emails sent.",
        inputSchema: z.object({ slug }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.getListing, { ...auth(ctx), slug: args.slug })),
    );

    server.registerTool(
      "list_awards",
      {
        title: "List awards",
        description: "The latest awards (HM, SOTD, SOTM, SOTY, First 100) with their site, date, award page and whether the winner was emailed.",
        inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.listAwards, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "get_creator",
      {
        title: "Get creator",
        description: "A studio or person: profile, website and links, private contact email, social handles, owner, and their listings.",
        inputSchema: z.object({ slug }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.getCreator, { ...auth(ctx), slug: args.slug })),
    );

    server.registerTool(
      "studios_without_contact",
      {
        title: "Studios without contact",
        description: "Studios with public listings that nobody claimed and that have no contact email yet: who to find an email for.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) => run(() => convex.query(api.mcp.studiosWithoutContact, auth(ctx))),
    );

    server.registerTool(
      "update_creator",
      {
        title: "Update creator contact",
        description:
          'Save a studio\'s private contact email and/or its social handles (instagram, facebook, linkedin: a handle, "@handle" or profile URL; LinkedIn like "company/studio"). "" clears a value.',
        inputSchema: z.object({
          slug,
          contactEmail: z.string().max(254).optional(),
          socials: z
            .object({ instagram: z.string().max(200).optional(), facebook: z.string().max(200).optional(), linkedin: z.string().max(200).optional() })
            .optional(),
        }),
      },
      async (args, ctx) => run(() => convex.mutation(api.mcp.updateCreator, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "claim_link",
      {
        title: "Claim link",
        description: "The secret claim link of an unclaimed listing (created on first use), for outreach. Null when it is already claimed.",
        inputSchema: z.object({ slug }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.claimLink, { ...auth(ctx), slug: args.slug })),
    );

    // The social queue

    server.registerTool(
      "social_queue",
      {
        title: "Social queue",
        description: "Social posts by status (default: waiting for captions/approval), newest first, with their facts, captions and media.",
        inputSchema: z.object({
          status: z.enum(["waiting", "approved", "scheduled", "sent", "failed", "rejected", "all"]).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.socialQueue, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "get_post",
      {
        title: "Get post",
        description:
          "One social post: kind, status, facts, captions, media, publish time, note, per-network publish results (sent/failed/skipped, links to the live posts, errors), and mediaDetails: for each media item in order its size and design recipe (how the graphic was rendered: re-render from it to edit the graphic; null when there is none).",
        inputSchema: z.object({ id: postId }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.getPost, { ...auth(ctx), id: args.id as Id<"socialPosts"> })),
    );

    server.registerTool(
      "update_post",
      {
        title: "Update post",
        description:
          "Save captions, media, publish time or a note on a post that isn't published yet. Never publishes. media replaces the whole list: to edit a graphic, send the list with the re-rendered URL in place of the old item (keep the others, their roles and networks). Editing an approved, scheduled or failed post sends it back to waiting (a scheduled publish is cancelled). A story needs exactly one 9:16 image or a 3-60 s video. publishAt: ISO date-time, Tbilisi time when no offset; null = as soon as approved.",
        inputSchema: z.object({
          id: postId,
          captions: captions.optional(),
          media: media.optional(),
          publishAt: z.string().nullable().optional(),
          note: z.string().max(500).optional(),
          placement: placement.optional(),
        }),
      },
      async (args, ctx) =>
        run(() =>
          convex.mutation(api.mcp.updatePost, {
            ...auth(ctx),
            id: args.id as Id<"socialPosts">,
            captions: args.captions,
            media: args.media,
            scheduledFor: parseWhen(args.publishAt),
            note: args.note,
            placement: args.placement,
          }),
        ),
    );

    server.registerTool(
      "create_post",
      {
        title: "Create post",
        description:
          "Start a post Giorgi asked for: an announcement, a custom post, or another kind. With listingSlug the post gets that site's facts and (for a feed post) its screenshots. Extra facts are merged in. placement \"story\" makes a story (attach exactly one 9:16 image or video).",
        inputSchema: z.object({
          kind: z.enum(["announcement", "custom", "new_listing", "award", "call_submissions", "call_jury", "roundup"]),
          listingSlug: slug.optional(),
          facts: z.record(z.string(), z.unknown()).optional(),
          captions: captions.optional(),
          media: media.optional(),
          placement: placement.optional(),
        }),
      },
      async (args, ctx) => run(() => convex.mutation(api.mcp.createPost, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "approve_post",
      {
        title: "Approve post",
        description:
          "Approve a waiting post: it is published (now, or at its publish time) to every network that has a caption and a connected account: Facebook Page, Instagram, Threads, Giorgi's LinkedIn. Only after Giorgi said yes to its final captions and the rendered images. A new-listing post also emails the studio that it is featured (with its claim link when unclaimed). The post then shows as scheduled; get_post shows each network's result.",
        inputSchema: z.object({ id: postId }),
      },
      async (args, ctx) => run(() => convex.mutation(api.mcp.approvePost, { ...auth(ctx), id: args.id as Id<"socialPosts"> })),
    );

    server.registerTool(
      "publish_post",
      {
        title: "Publish post",
        description:
          "Approve and publish a waiting post in one step: now, or at `at` (a future time; a past or missing one means now). A scheduled post is rescheduled. Same rules and effects as approve_post: only after Giorgi said yes to its final captions and images. A failed post is sent again with retry_post instead.",
        inputSchema: z.object({ id: postId, at: when.optional() }),
      },
      async (args, ctx) =>
        run(() =>
          convex.mutation(api.mcp.publishPost, { ...auth(ctx), id: args.id as Id<"socialPosts">, at: parseWhen(args.at) ?? undefined }),
        ),
    );

    server.registerTool(
      "unschedule_post",
      {
        title: "Unschedule post",
        description: "Take a scheduled post back to waiting: its publish is cancelled; its publish time is kept. Not while it is being published.",
        inputSchema: z.object({ id: postId }),
      },
      async (args, ctx) => run(() => convex.mutation(api.mcp.unschedulePost, { ...auth(ctx), id: args.id as Id<"socialPosts"> })),
    );

    server.registerTool(
      "retry_post",
      {
        title: "Retry post",
        description:
          "Publish a failed post again (or one that found no connected account, or one whose publish run stopped): only the networks that aren't sent yet are attempted; networks already sent are never sent twice. Use after fixing the cause (list_channels shows connection errors). An approved post with no publish results was approved before publishing existed and may have been posted by hand: it can't be retried; ask Giorgi, and to publish it, update_post (back to waiting) and approve it again.",
        inputSchema: z.object({ id: postId }),
      },
      async (args, ctx) => run(() => convex.mutation(api.mcp.retryPost, { ...auth(ctx), id: args.id as Id<"socialPosts"> })),
    );

    server.registerTool(
      "list_channels",
      {
        title: "List channels",
        description:
          "The networks posts go to (Facebook Page, Instagram, Threads, LinkedIn): whether each is connected, the page name or username, when its token expires, and the last error. Picks up newly set tokens first. Tokens are set by Giorgi as Convex env vars (META_PAGE_ACCESS_TOKEN, THREADS_ACCESS_TOKEN, LINKEDIN_ACCESS_TOKEN) and are never shown.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) => run(() => convex.action(api.mcp.listChannels, auth(ctx))),
    );

    // Graphics and voiceovers

    server.registerTool(
      "list_templates",
      {
        title: "List templates",
        description:
          "The graphic templates (their text fields, image slots and defaults) and formats (size, and how Instagram uses each: feed, padded with white for the feed, or story) that render_graphic accepts.",
        inputSchema: z.object({}),
      },
      async () => text(templateCatalog()),
    );

    server.registerTool(
      "list_palettes",
      {
        title: "List palettes",
        description: "The colour palettes for render_graphic and render_carousel: id, name, and the base / surface / accent colours (60/30/10).",
        inputSchema: z.object({}),
      },
      async () => text(paletteCatalog()),
    );

    server.registerTool(
      "list_styles",
      {
        title: "List styles",
        description:
          "The visual styles for render_graphic and render_carousel (glass, the frosted look and the default, plus flat styles that render fast), with what each looks like.",
        inputSchema: z.object({}),
      },
      async () => text(styleCatalog()),
    );

    server.registerTool(
      "list_media",
      {
        title: "List media",
        description:
          "Uploaded files newest first, with URLs, sizes and dimensions, to reuse instead of rendering again. role: graphic (rendered graphics), carousel (carousel slides), reel (finished reels), screenshot / preview (listing media). folder narrows to a path, e.g. social/graphics.",
        inputSchema: z.object({
          kind: z.enum(["image", "video"]).optional(),
          role: z.enum(MEDIA_ROLE_ENUM).optional(),
          folder: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.listMedia, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "get_designs",
      {
        title: "Get designs",
        description:
          "For image or video URLs (e.g. from list_media or a post's media): each one's size and design recipe, in order, or nulls for a file we don't hold. design.kind graphic: render_graphic's arguments; design.kind carousel: render_carousel's (listingSlug, facts, palette, style, story) plus slideIndex, slideName, total and setId. Re-render from it with changes to edit a graphic.",
        inputSchema: z.object({ urls: z.array(z.string().url()).min(1).max(50) }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.getDesigns, { ...auth(ctx), urls: args.urls })),
    );

    server.registerTool(
      "find_reel",
      {
        title: "Find reel",
        description:
          "The latest finished reel (MP4 with voiceover, built on the Studio Reels page) of a listing, with its URL and size, or null. Attach it to a post as a video (an Instagram reel, or a story when it is 9:16 and the post's placement is story).",
        inputSchema: z.object({ listingSlug: slug }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.findReel, { ...auth(ctx), listingSlug: args.listingSlug })),
    );

    server.registerTool(
      "render_graphic",
      {
        title: "Render graphic",
        description:
          "Render one post graphic (JPEG, uploaded to ImageKit) and return its public URL and size, to attach with update_post (kind image, role graphic). Its recipe (these arguments) is kept with the file: get_post / get_designs show it as design, so the graphic can be edited later by rendering again with changes. list_templates shows every template's fields and every format. For an Instagram feed post use ig_portrait or square (it takes 4:5 to 1.91:1; story, reel_cover and link are padded with white there); for a story post use story. fields are the template's texts, e.g. { tier: \"SOTD\", title, studio, date, awardSlug, url } for award; imageUrls the template's images in order (award: [screenshot, badge], others: [screenshot]).",
        inputSchema: z.object({
          template: z.enum(TEMPLATE_ENUM),
          format: z.enum(FORMAT_ENUM),
          palette,
          fields: z.record(z.string(), z.string()).optional(),
          imageUrls: z.array(z.string().url()).max(4).optional(),
          style,
          glass,
        }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.renderGraphic, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "render_carousel",
      {
        title: "Render carousel",
        description:
          "Render a listing's storytelling carousel (6-8 JPEG slides, 1080x1350) in a style from its facts, screenshots, award and jury, and return the slide URLs in order (the first is the hook slide) with the slide names. Each slide keeps its recipe (these arguments, its place in the set and the set id): get_post shows it as design, so the carousel can be edited by rendering it again with changes. Attach the slides with update_post (networks instagram, facebook, linkedin) and the hook slide for Threads. facts override or supply texts (title, studio, url, tagline, kicker, date, tier, awardSlug, score, quote, juror, role, cta, ...); story adds chips/notes for the detail slides, the last slide's cta, glass, and screenshot overrides.",
        inputSchema: z.object({
          listingSlug: slug.optional(),
          facts: z.record(z.string(), z.string()).optional(),
          palette,
          style,
          story: z
            .object({
              chips: z.array(z.string().max(60)).max(4).optional(),
              notes: z.array(z.string().max(200)).max(4).optional(),
              cta: z.string().max(120).optional(),
              glass,
              shots: z.array(z.string().url()).max(4).optional(),
              mobile: z.string().url().optional(),
            })
            .optional(),
        }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.renderCarousel, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "list_voices",
      {
        title: "List voices",
        description:
          "The voiceover narrators (ElevenLabs) with sample clips. With listingSlug, also the listing's preview video length and how many words of narration fit it (about 2.5 words a second). Free: uses no credits.",
        inputSchema: z.object({ listingSlug: slug.optional() }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.listVoices, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "create_voiceover",
      {
        title: "Create voiceover",
        description:
          "Voice a narration script for a listing's preview video with ElevenLabs and return the MP3 URL and its length. Spends ElevenLabs credits: only after Giorgi approved the script and the voice. The reel itself (the muted preview with this narration) is built by Giorgi on the Studio Reels page (studio.shemoqmedi.space/reels), which uploads it; then attach the reel's URL to the post as a video.",
        inputSchema: z.object({ listingSlug: slug, script: z.string().min(1).max(2000), voice: z.string().min(1).max(80).describe("Narrator name from list_voices") }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.createVoiceover, { ...auth(ctx), ...args })),
    );

    server.registerTool(
      "reject_post",
      {
        title: "Reject post",
        description: "Drop a post that shouldn't go out, with an optional reason.",
        inputSchema: z.object({ id: postId, note: z.string().max(500).optional() }),
      },
      async (args, ctx) =>
        run(() => convex.mutation(api.mcp.rejectPost, { ...auth(ctx), id: args.id as Id<"socialPosts">, note: args.note })),
    );

    // Email

    const emailInput = {
      listingSlug: slug.optional().describe("Email this listing's studio (owner, else contact email)"),
      creatorSlug: slug.optional().describe("Email this creator (owner, else contact email)"),
      to: z.string().max(254).optional().describe("Any address (outreach to a studio not in the database), or override the recipient"),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(10000).describe("Plain text; blank lines separate paragraphs; URLs become links; {claimLink} = the listing's claim link"),
    };

    server.registerTool(
      "preview_email",
      {
        title: "Preview email",
        description: "Shows exactly who gets what, without sending. Always preview and show Giorgi before send_email.",
        inputSchema: z.object(emailInput),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.sendEmail, { ...auth(ctx), ...args, confirm: false })),
    );

    server.registerTool(
      "send_email",
      {
        title: "Send email",
        description:
          "Sends one email (with an unsubscribe footer; skipped if the person unsubscribed) and logs it. confirm must be true and may only be set after Giorgi approved the preview of this exact email.",
        inputSchema: z.object({ ...emailInput, confirm: z.literal(true) }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.sendEmail, { ...auth(ctx), ...args, confirm: true })),
    );

    server.registerTool(
      "preview_broadcast",
      {
        title: "Preview broadcast",
        description: "How many people an audience reaches (minus unsubscribed) and the first few addresses. Nothing is sent.",
        inputSchema: z.object({ audience, subject: z.string().min(1).max(200), body: z.string().min(1).max(20000) }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.sendBroadcast, { ...auth(ctx), ...args, confirm: false })),
    );

    server.registerTool(
      "send_broadcast",
      {
        title: "Send broadcast",
        description:
          "Emails everyone in the audience in the background (each with their own unsubscribe link). confirm must be true, only after Giorgi saw the recipient count and the full text and said yes.",
        inputSchema: z.object({ audience, subject: z.string().min(1).max(200), body: z.string().min(1).max(20000), confirm: z.literal(true) }),
      },
      async (args, ctx) => run(() => convex.action(api.mcp.sendBroadcast, { ...auth(ctx), ...args, confirm: true })),
    );

    server.registerTool(
      "email_history",
      {
        title: "Email history",
        description: "Emails sent (newest first), optionally to one address: subject, kind, status and errors.",
        inputSchema: z.object({ to: z.string().max(254).optional(), limit: z.number().int().min(1).max(200).optional() }),
      },
      async (args, ctx) => run(() => convex.query(api.mcp.emailHistory, { ...auth(ctx), ...args })),
    );
  },
  {
    serverInfo: { name: "shemoqmedi-desk", version: "1.0.0" },
    instructions: INSTRUCTIONS,
  },
);

/**
 * Checks the bearer token of an MCP request: a Clerk OAuth access token from
 * "Sign in with Shemoqmedi". It becomes a short signed credential that tells
 * Convex which Clerk user this is, and Convex decides whether the person is an
 * admin: anyone else gets undefined here, so a 401.
 */
export async function verifyToken(req: Request, token: string | undefined): Promise<AuthInfo | undefined> {
  if (!token) {
    return undefined;
  }
  const oauth = await verifyOAuthToken(req).catch((error: unknown) => {
    console.error("MCP OAuth token check failed", error);
    return null;
  });
  if (oauth === null) {
    // Logged (never the token) so a connector that shows no tools can be diagnosed.
    console.warn("MCP sign-in refused: Clerk did not accept the access token (expired, or for another resource).");
    return undefined;
  }
  const credential = await serviceCredential(oauth.userId);
  const me = await convex.query(api.mcp.whoami, { token: credential });
  if (me === null) {
    console.warn(
      `MCP sign-in refused: Clerk user ${oauth.userId} is not a Shemoqmedi admin, or MCP_SERVICE_SECRET differs between Vercel and Convex.`,
    );
    return undefined;
  }
  return {
    token: credential,
    clientId: me.userId,
    scopes: oauth.scopes,
    extra: { email: me.email, origin: publicOrigin(req), client: oauth.clientId },
  };
}

/** /api/mcp: bearer tokens are checked against Convex; anything else is a 401. */
export const headerAuthHandler = withMcpAuth(handler, verifyToken, { required: true });
