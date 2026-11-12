// The four networks' publishing APIs, with plain fetch (no SDKs, no servers).
// Used by convex/publish.ts (posting) and convex/channels.ts (account ids,
// Threads token refresh).
//
//   Facebook Page + Instagram   graph.facebook.com/{GRAPH_VERSION} with the Page token
//                               (Instagram API with Facebook Login)
//   Threads                     graph.threads.net/v1.0 with the Threads user token
//   LinkedIn (personal profile) api.linkedin.com/rest (Posts + Images APIs) with the
//                               member token (w_member_social)
//
// Stories (socialPosts.placement "story"): Instagram STORIES containers and
// Facebook Page photo_stories / video_stories (Pages API, Page Stories).
// Threads and LinkedIn have no stories API; publish.begin skips them.
//
// Tokens travel only in Authorization headers, never in URLs, and are scrubbed
// from every error message.
//
// Every publish function takes a `deadline` (epoch ms): no request starts and
// no wait begins that could run past it, and every request has a timeout, so
// one publish run always ends inside Convex's 10-minute action limit.

export const GRAPH_VERSION = "v26.0"; // Graph API: latest in the official versions table (2026-07-29)
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const THREADS_GRAPH = "https://graph.threads.net/v1.0";
export const THREADS_REFRESH = "https://graph.threads.net/refresh_access_token";
export const LINKEDIN = "https://api.linkedin.com";
export const LINKEDIN_VERSION = "202610"; // latest LinkedIn-Version (supported until 2027-10)

export type Network = "facebook" | "instagram" | "threads" | "linkedin";
export const NETWORKS: Network[] = ["facebook", "instagram", "threads", "linkedin"];
export const NETWORK_NAME: Record<Network, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  threads: "Threads",
  linkedin: "LinkedIn",
};

/** Feed post (absent) or story (socialPosts.placement). */
export type Placement = "feed" | "story";

/** width/height are filled in from the media table when known (publish.begin), for Instagram's ratio check. */
export type MediaItem = { kind: "image" | "video"; url: string; role?: string; networks?: Network[]; width?: number; height?: number };

/** What one network gets: its caption, its media, and the post's link. */
export type Draft = {
  caption: string;
  media: MediaItem[];
  link: string | null; // the award or listing page
  title: string | null; // for a LinkedIn article card
  description: string | null;
  thumbnail: string | null; // a screenshot for a LinkedIn article card
  placement?: Placement; // absent = feed
};

export type Published = { remoteId: string; url?: string; note?: string };

/** A platform refused or failed; the message is safe to store and show. */
export class PlatformError extends Error {}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Removes a token (and any access_token=… query) from text that may be stored or shown. */
export function scrub(text: string, ...tokens: (string | undefined)[]) {
  let out = text;
  for (const t of tokens) if (t && t.length >= 8) out = out.split(t).join("[token]");
  return out.replace(/(access_token=)[^&\s"')]+/gi, "$1[token]").replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1[token]");
}

/** A wait as it will really last: SOCIAL_WAIT_SCALE (default 1) scales every wait; 0 turns waiting off (tests). */
function scaledMs(ms: number) {
  const raw = Number(process.env.SOCIAL_WAIT_SCALE ?? "1");
  return ms * (Number.isFinite(raw) && raw >= 0 ? raw : 1);
}

/** Waits inside an action (scaled by SOCIAL_WAIT_SCALE). */
export async function pause(ms: number) {
  const scaled = scaledMs(ms);
  if (scaled <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, scaled));
}

/** The longest a single platform request may take. */
export const REQUEST_TIMEOUT_MS = 45_000;
/** No request starts with less time than this left before the deadline. */
const MIN_REQUEST_MS = 10_000;

/** Thrown when a run's deadline leaves no time for the next step. Nothing was sent by that step. */
function outOfTime(what: string) {
  return new PlatformError(
    `${what}: this publish run ran out of time (Convex stops a run after 10 minutes) before it could finish. Nothing more was sent; retry the post.`,
  );
}

/** Waits `ms`, unless that would end past the deadline (then it throws instead of waiting). */
async function pauseWithin(ms: number, deadline: number, what: string) {
  if (Date.now() + scaledMs(ms) > deadline) throw outOfTime(what);
  await pause(ms);
}

/** An abort signal for one request: REQUEST_TIMEOUT_MS, never past the deadline. Throws when no time is left. */
function requestSignal(deadline: number, what: string) {
  const left = deadline - Date.now();
  if (left < MIN_REQUEST_MS) throw outOfTime(what);
  return AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, left));
}

// ─────────────────────────────────────────────────────────────────────────────
// Threads' character count
// ─────────────────────────────────────────────────────────────────────────────

const THREADS_EMOJI = /[\p{Extended_Pictographic}‍︎️⃣]/u;

function utf8Bytes(codePoint: number) {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/**
 * A text's length the way Threads counts it for its 500-character limit:
 * "Emojis are counted as the number of UTF-8 bytes" (developers.facebook.com/docs/threads/posts).
 * Emoji (and their joiners, variation selectors and keycaps) and every character
 * outside the Basic Multilingual Plane count as their UTF-8 bytes (🏆 = 4, ✨ = 3,
 * ➡️ = 6); everything else counts as 1. Never less than `text.length`.
 */
export function threadsLength(text: string) {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    n += cp > 0xffff || THREADS_EMOJI.test(ch) ? utf8Bytes(cp) : 1;
  }
  return n;
}

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The media a network gets: items without `networks`, or naming it. */
export function mediaFor(media: MediaItem[], network: Network) {
  return media.filter((m) => !m.networks || m.networks.length === 0 || m.networks.includes(network));
}

/**
 * A URL Meta, Threads and LinkedIn can read as JPEG. Screenshots are WebP on
 * ImageKit (IMAGEKIT_URL_ENDPOINT), which none of them accept everywhere, so
 * ImageKit URLs get the f-jpg format transform. Other URLs are used as they are.
 */
export function jpegUrl(url: string) {
  const parsed = imagekitUrl(url);
  if (!parsed) return url;
  const tr = parsed.searchParams.get("tr");
  if (tr && /(^|[,:])f-jpg($|[,:])/.test(tr)) return url;
  parsed.searchParams.set("tr", tr ? `${tr}:f-jpg` : "f-jpg");
  return parsed.toString();
}

/** The URL parsed when it is on our ImageKit endpoint (IMAGEKIT_URL_ENDPOINT), else null. */
function imagekitUrl(url: string) {
  const endpoint = process.env.IMAGEKIT_URL_ENDPOINT?.trim();
  let host: string | null = null;
  try {
    host = endpoint ? new URL(endpoint).host : null;
  } catch {
    host = null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return host && parsed.host === host ? parsed : null;
}

/** Instagram feed images and carousel items must be between 4:5 (0.8) and 1.91:1. */
export const IG_MIN_RATIO = 0.8;
export const IG_MAX_RATIO = 1.91;

/**
 * The JPEG URL Instagram gets for an image. Instagram refuses images outside
 * 4:5 to 1.91:1 (IG User Media reference, image specifications), so an image
 * whose size is known and falls outside that range is padded on ImageKit
 * (cm-pad_resize, white) to 1080x1350 (taller ones) or 1080x566 (wider ones).
 * Throws a PlatformError for such an image that is not on ImageKit. Images of
 * unknown size are sent as they are.
 */
export function instagramImageUrl(item: Pick<MediaItem, "url" | "width" | "height">) {
  const { url, width, height } = item;
  if (!width || !height) return jpegUrl(url);
  const ratio = width / height;
  if (ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO) return jpegUrl(url);
  const parsed = imagekitUrl(url);
  if (!parsed) {
    throw new PlatformError(
      `Instagram takes images between 4:5 and 1.91:1, and ${url} is ${width}x${height}. Attach an ig_portrait or square graphic for Instagram instead.`,
    );
  }
  const box = ratio < IG_MIN_RATIO ? "w-1080,h-1350" : "w-1080,h-566";
  const tr = parsed.searchParams.get("tr");
  const pad = `${box},cm-pad_resize,bg-FFFFFF,f-jpg`;
  parsed.searchParams.set("tr", tr ? `${tr}:${pad}` : pad);
  return parsed.toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Stories
// ─────────────────────────────────────────────────────────────────────────────

/** Why a story skips a network without a stories API (publish.begin records it as skipped). */
export const NO_STORIES: Partial<Record<Network, string>> = {
  threads: "Threads has no stories: a story goes to Instagram and Facebook only.",
  linkedin: "LinkedIn has no stories: a story goes to Instagram and Facebook only.",
};

/** The networks that have a stories API (Instagram STORIES, Facebook Page photo/video stories). */
export const STORY_NETWORKS: Network[] = ["instagram", "facebook"];

/** Stories are 9:16 (1080x1920). A few pixels off (an encoder's rounding) still count. */
export const STORY_RATIO = 9 / 16;
const STORY_RATIO_TOLERANCE = 0.02;

/**
 * Why a story can't go out with these media, or null. A story is exactly one
 * image or video at 9:16; a size we don't know (no media row) is left to Meta.
 */
export function storyProblem(media: Pick<MediaItem, "kind" | "url" | "width" | "height">[]) {
  if (media.length !== 1) {
    return `A story is exactly one image or video (this one has ${media.length}). Attach one 9:16 story graphic or reel.`;
  }
  const { width, height, url } = media[0];
  if (!width || !height) return null;
  if (Math.abs(width / height - STORY_RATIO) > STORY_RATIO_TOLERANCE) {
    return `A story must be 9:16 (1080x1920), and ${url} is ${width}x${height}. Render it in the story format.`;
  }
  return null;
}

type Json = Record<string, unknown>;

async function readJson(res: Response): Promise<Json> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return { raw: `(the response could not be read: ${(err as Error).message})` };
  }
  if (!text) return {};
  try {
    const data: unknown = JSON.parse(text);
    return typeof data === "object" && data !== null ? (data as Json) : { value: data };
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

/** "message (code 190)" from a Graph / Threads error body. */
function graphError(data: Json, status: number) {
  const err = data.error as { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } | undefined;
  if (!err) return `HTTP ${status}${data.raw ? `: ${String(data.raw)}` : ""}`;
  const message = err.error_user_msg || err.message || "unknown error";
  const code = err.code !== undefined ? ` (code ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""})` : "";
  const hint = err.code === 190 ? " The token is invalid or expired: generate a new one and set it on Convex." : "";
  return `${message}${code}${hint}`;
}

/**
 * A Graph-style call (Facebook, Instagram, Threads): form-encoded POSTs, query
 * GETs, Bearer token. Times out after REQUEST_TIMEOUT_MS, and never runs past
 * `deadline`.
 */
export async function graph(
  method: "GET" | "POST",
  url: string,
  token: string,
  params: Record<string, string> = {},
  deadline = Infinity,
): Promise<Json> {
  const signal = requestSignal(deadline, `${method} ${new URL(url).host}`);
  let res: Response;
  try {
    if (method === "GET") {
      const u = new URL(url);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal });
    } else {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        signal,
      });
    }
  } catch (err) {
    throw new PlatformError(scrub(`Could not reach ${new URL(url).host}: ${(err as Error).message}`, token));
  }
  const data = await readJson(res);
  if (!res.ok || data.error) throw new PlatformError(scrub(graphError(data, res.status), token));
  return data;
}

function idOf(data: Json, what: string) {
  const id = data.id;
  if (typeof id !== "string" && typeof id !== "number") throw new PlatformError(`${what}: no id in the response.`);
  return String(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Account lookups (channels.sync)
// ─────────────────────────────────────────────────────────────────────────────

/** How a failed Instagram lookup is reported (the Facebook Page itself was found). */
export const IG_LOOKUP_FAILED = "Instagram lookup failed";

/**
 * The Page behind a Page token, and its linked Instagram Business account. The
 * Instagram lookup can fail on its own (a missing instagram_basic permission, a
 * transient error): the Page is still returned, with `partialError`, so
 * Facebook keeps working.
 */
export async function metaIds(token: string): Promise<{
  ids: { pageId: string; pageName?: string; igUserId?: string; igUsername?: string };
  partialError?: string;
}> {
  const page = await graph("GET", `${GRAPH}/me`, token, { fields: "id,name" });
  const pageId = idOf(page, "Facebook Page");
  const pageName = typeof page.name === "string" ? page.name : undefined;
  let linked: Json;
  try {
    linked = await graph("GET", `${GRAPH}/${pageId}`, token, { fields: "instagram_business_account{id,username}" });
  } catch (err) {
    return { ids: { pageId, ...(pageName ? { pageName } : {}) }, partialError: `${IG_LOOKUP_FAILED}: ${(err as Error).message}` };
  }
  const ig = linked.instagram_business_account as { id?: string; username?: string } | undefined;
  return {
    ids: {
      pageId,
      ...(pageName ? { pageName } : {}),
      ...(ig?.id ? { igUserId: String(ig.id) } : {}),
      ...(ig?.username ? { igUsername: ig.username } : {}),
    },
  };
}

export async function threadsIds(token: string) {
  const me = await graph("GET", `${THREADS_GRAPH}/me`, token, { fields: "id,username" });
  return { threadsUserId: idOf(me, "Threads user"), threadsUsername: typeof me.username === "string" ? me.username : undefined };
}

export async function linkedinIds(token: string) {
  let res: Response;
  try {
    res = await fetch(`${LINKEDIN}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` }, signal: requestSignal(Infinity, "LinkedIn") });
  } catch (err) {
    throw new PlatformError(scrub(`Could not reach LinkedIn: ${(err as Error).message}`, token));
  }
  const data = await readJson(res);
  if (!res.ok) throw new PlatformError(scrub(linkedinError(data, res.status), token));
  if (typeof data.sub !== "string" || !data.sub) throw new PlatformError("LinkedIn userinfo has no sub (the token needs openid + profile).");
  return { personUrn: `urn:li:person:${data.sub}`, name: typeof data.name === "string" ? data.name : undefined };
}

/** th_refresh_token: a fresh 60-day Threads token. */
export async function refreshThreadsToken(token: string) {
  const data = await graph("GET", THREADS_REFRESH, token, { grant_type: "th_refresh_token" });
  if (typeof data.access_token !== "string" || !data.access_token) throw new PlatformError("Threads did not return a refreshed token.");
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 60 * 24 * 60 * 60;
  return { token: data.access_token, expiresInMs: expiresIn * 1000 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Facebook Page
// ─────────────────────────────────────────────────────────────────────────────

/** The first item decides: a video post, or the images (the rest are noted). */
function pick(media: MediaItem[]) {
  const first = media[0];
  if (!first) return { kind: "none" as const, images: [], video: null };
  if (first.kind === "video") return { kind: "video" as const, images: [], video: first, dropped: media.length - 1 };
  const images = media.filter((m) => m.kind === "image");
  return { kind: "images" as const, images, video: null, dropped: media.length - images.length };
}

function droppedNote(dropped: number | undefined, what: string) {
  return dropped ? `${dropped} ${dropped === 1 ? "item" : "items"} not posted (${what}).` : undefined;
}

export async function publishFacebook(draft: Draft, token: string, pageId: string, deadline = Infinity): Promise<Published> {
  if (draft.placement === "story") return await publishFacebookStory(draft, token, pageId, deadline);
  const chosen = pick(draft.media);
  if (chosen.kind === "video") {
    const data = await graph("POST", `${GRAPH}/${pageId}/videos`, token, { file_url: chosen.video.url, description: draft.caption }, deadline);
    const id = idOf(data, "Facebook video");
    return { remoteId: id, url: `https://www.facebook.com/${pageId}/videos/${id}`, note: droppedNote(chosen.dropped, "a video post carries one video") };
  }
  const images = chosen.images;
  if (images.length === 1) {
    // Page Photos: `caption` is the post's text (`message` is deprecated there).
    const data = await graph("POST", `${GRAPH}/${pageId}/photos`, token, { url: jpegUrl(images[0].url), caption: draft.caption }, deadline);
    const postId = typeof data.post_id === "string" ? data.post_id : idOf(data, "Facebook photo");
    return { remoteId: postId, url: `https://www.facebook.com/${postId}`, note: droppedNote(chosen.dropped, "videos don't mix with photos") };
  }
  if (images.length > 1) {
    const photoIds: string[] = [];
    for (const image of images) {
      const data = await graph("POST", `${GRAPH}/${pageId}/photos`, token, { url: jpegUrl(image.url), published: "false" }, deadline);
      photoIds.push(idOf(data, "Facebook photo"));
    }
    // A feed post with attached_media: here the text is `message`.
    const params: Record<string, string> = { message: draft.caption };
    photoIds.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    const data = await graph("POST", `${GRAPH}/${pageId}/feed`, token, params, deadline);
    const postId = idOf(data, "Facebook post");
    return { remoteId: postId, url: `https://www.facebook.com/${postId}`, note: droppedNote(chosen.dropped, "videos don't mix with photos") };
  }
  const params: Record<string, string> = { message: draft.caption };
  if (draft.link) params.link = draft.link;
  const data = await graph("POST", `${GRAPH}/${pageId}/feed`, token, params, deadline);
  const postId = idOf(data, "Facebook post");
  return { remoteId: postId, url: `https://www.facebook.com/${postId}` };
}

/** Meta's stories take no text: said once in the result, so nobody looks for the caption. */
const STORY_NOTE = "Posted as a story (stories carry no caption).";

const FB_UPLOAD_HOST = "rupload.facebook.com";
const FB_VIDEO_WAIT = { everyMs: 10_000, tries: 30 }; // up to 5 minutes

/**
 * A Page story (Pages API, Page Stories): a photo is uploaded unpublished and
 * then published with photo_stories; a video is started on video_stories,
 * fetched by Meta from its public URL (rupload, file_url header), and finished
 * once Meta has it. Both answer { success, post_id }.
 */
async function publishFacebookStory(draft: Draft, token: string, pageId: string, deadline: number): Promise<Published> {
  const problem = storyProblem(draft.media);
  if (problem) throw new PlatformError(problem);
  const item = draft.media[0];
  let done: Json;
  if (item.kind === "image") {
    const photo = await graph("POST", `${GRAPH}/${pageId}/photos`, token, { url: jpegUrl(item.url), published: "false" }, deadline);
    done = await graph("POST", `${GRAPH}/${pageId}/photo_stories`, token, { photo_id: idOf(photo, "Facebook story photo") }, deadline);
  } else {
    const start = await graph("POST", `${GRAPH}/${pageId}/video_stories`, token, { upload_phase: "start" }, deadline);
    const videoId = typeof start.video_id === "string" || typeof start.video_id === "number" ? String(start.video_id) : null;
    if (!videoId || typeof start.upload_url !== "string") throw new PlatformError("Facebook did not return a story upload URL.");
    await uploadHostedVideo(start.upload_url, item.url, token, deadline);
    await waitForVideoUpload(videoId, token, deadline);
    done = await graph("POST", `${GRAPH}/${pageId}/video_stories`, token, { video_id: videoId, upload_phase: "finish" }, deadline);
  }
  if (done.success === false) throw new PlatformError("Facebook refused the story.");
  const postId = typeof done.post_id === "string" || typeof done.post_id === "number" ? String(done.post_id) : null;
  if (!postId) throw new PlatformError("Facebook story: no post_id in the response.");
  return { remoteId: postId, url: `https://www.facebook.com/${postId}`, note: STORY_NOTE };
}

/** Asks Meta to fetch a hosted video into an upload session (the token goes only to Meta's upload host). */
async function uploadHostedVideo(uploadUrl: string, fileUrl: string, token: string, deadline: number) {
  let host = "";
  try {
    host = new URL(uploadUrl).host;
  } catch {
    // reported below
  }
  if (host !== FB_UPLOAD_HOST) throw new PlatformError(`Facebook returned an unexpected upload host (${host || "none"}).`);
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
      signal: requestSignal(deadline, "Facebook story upload"),
    });
  } catch (err) {
    throw new PlatformError(scrub(`Could not reach ${FB_UPLOAD_HOST}: ${(err as Error).message}`, token));
  }
  const data = await readJson(res);
  if (!res.ok || data.error || data.success === false) {
    throw new PlatformError(scrub(`Facebook story upload: ${graphError(data, res.status)}`, token));
  }
}

/** Waits until Meta has fetched the video (status.uploading_phase complete). */
async function waitForVideoUpload(videoId: string, token: string, deadline: number) {
  for (let i = 0; i < FB_VIDEO_WAIT.tries; i++) {
    const data = await graph("GET", `${GRAPH}/${videoId}`, token, { fields: "status" }, deadline);
    const status = (data.status ?? {}) as { video_status?: string; uploading_phase?: { status?: string } };
    const phase = status.uploading_phase?.status;
    if (phase === "error" || status.video_status === "error") throw new PlatformError("The Facebook story video could not be processed.");
    if (phase === "complete") return;
    if (i < FB_VIDEO_WAIT.tries - 1) await pauseWithin(FB_VIDEO_WAIT.everyMs, deadline, "The Facebook story video (still uploading)");
  }
  throw new PlatformError("The Facebook story video was still uploading after 5 minutes. Retry later.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram (Business, via Facebook Login)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polls a container's status until FINISHED (Meta: check about once a minute
 * for up to 5 minutes; we poll more often). Never waits past `deadline`.
 */
async function waitForContainer(
  base: string,
  id: string,
  token: string,
  opts: { field: "status_code" | "status"; everyMs: number; tries: number; label: string; firstWaitMs?: number; deadline: number },
) {
  if (opts.firstWaitMs) await pauseWithin(opts.firstWaitMs, opts.deadline, opts.label);
  for (let i = 0; i < opts.tries; i++) {
    const data = await graph(
      "GET",
      `${base}/${id}`,
      token,
      { fields: opts.field === "status" ? "status,error_message" : "status_code,status" },
      opts.deadline,
    );
    const state = String(data[opts.field] ?? "");
    if (state === "FINISHED" || state === "PUBLISHED") return;
    if (state === "ERROR" || state === "EXPIRED") {
      const why = data.error_message ?? data.status ?? state;
      throw new PlatformError(`${opts.label} could not be processed: ${String(why)}`);
    }
    if (i < opts.tries - 1) await pauseWithin(opts.everyMs, opts.deadline, `${opts.label} (still processing)`);
  }
  throw new PlatformError(`${opts.label} was still processing after ${Math.round((opts.tries * opts.everyMs) / 60_000)} minutes. Retry later.`);
}

async function permalink(base: string, id: string, token: string, deadline: number) {
  try {
    const data = await graph("GET", `${base}/${id}`, token, { fields: "permalink" }, deadline);
    return typeof data.permalink === "string" ? data.permalink : undefined;
  } catch {
    return undefined;
  }
}

const IG_IMAGE_WAIT = { everyMs: 3_000, tries: 20 };
const IG_VIDEO_WAIT = { everyMs: 15_000, tries: 20 }; // up to 5 minutes

/**
 * An Instagram story: one container with media_type STORIES and image_url or
 * video_url (no caption: stories have none), polled until FINISHED, then
 * media_publish like any post.
 */
async function publishInstagramStory(draft: Draft, token: string, igUserId: string, deadline: number): Promise<Published> {
  const problem = storyProblem(draft.media);
  if (problem) throw new PlatformError(problem);
  const item = draft.media[0];
  const source: Record<string, string> = item.kind === "video" ? { video_url: item.url } : { image_url: jpegUrl(item.url) };
  const data = await graph("POST", `${GRAPH}/${igUserId}/media`, token, { media_type: "STORIES", ...source }, deadline);
  const creationId = idOf(data, "Instagram story");
  const wait = item.kind === "video" ? IG_VIDEO_WAIT : IG_IMAGE_WAIT;
  await waitForContainer(GRAPH, creationId, token, { field: "status_code", ...wait, label: "The Instagram story", deadline });
  const published = await graph("POST", `${GRAPH}/${igUserId}/media_publish`, token, { creation_id: creationId }, deadline);
  const id = idOf(published, "Instagram story");
  return { remoteId: id, url: await permalink(GRAPH, id, token, deadline), note: STORY_NOTE };
}

export async function publishInstagram(draft: Draft, token: string, igUserId: string, deadline = Infinity): Promise<Published> {
  if (draft.placement === "story") return await publishInstagramStory(draft, token, igUserId, deadline);
  const chosen = pick(draft.media);
  const media = `${GRAPH}/${igUserId}/media`;
  let creationId: string;
  let note: string | undefined;
  if (chosen.kind === "none") throw new PlatformError("Instagram needs an image or a video.");
  if (chosen.kind === "video") {
    const data = await graph(
      "POST",
      media,
      token,
      { media_type: "REELS", video_url: chosen.video.url, caption: draft.caption, share_to_feed: "true" },
      deadline,
    );
    creationId = idOf(data, "Instagram reel");
    await waitForContainer(GRAPH, creationId, token, { field: "status_code", ...IG_VIDEO_WAIT, label: "The Instagram reel", deadline });
    note = droppedNote(chosen.dropped, "a reel carries one video");
  } else if (chosen.images.length === 1) {
    const data = await graph("POST", media, token, { image_url: instagramImageUrl(chosen.images[0]), caption: draft.caption }, deadline);
    creationId = idOf(data, "Instagram image");
    await waitForContainer(GRAPH, creationId, token, { field: "status_code", ...IG_IMAGE_WAIT, label: "The Instagram image", deadline });
    note = droppedNote(chosen.dropped, "videos don't mix with photos");
  } else {
    const images = chosen.images.slice(0, 10);
    const urls = images.map(instagramImageUrl); // refuses an unfixable ratio before anything is created
    const children: string[] = [];
    for (const url of urls) {
      const data = await graph("POST", media, token, { image_url: url, is_carousel_item: "true" }, deadline);
      children.push(idOf(data, "Instagram carousel item"));
    }
    // Meta processes the items side by side: wait for them together.
    await Promise.all(
      children.map((child) =>
        waitForContainer(GRAPH, child, token, { field: "status_code", ...IG_IMAGE_WAIT, label: "An Instagram carousel image", deadline }),
      ),
    );
    const parent = await graph("POST", media, token, { media_type: "CAROUSEL", children: children.join(","), caption: draft.caption }, deadline);
    creationId = idOf(parent, "Instagram carousel");
    await waitForContainer(GRAPH, creationId, token, { field: "status_code", ...IG_IMAGE_WAIT, label: "The Instagram carousel", deadline });
    const dropped = (chosen.dropped ?? 0) + (chosen.images.length - images.length);
    note = droppedNote(dropped, "a carousel takes up to 10 photos, no videos here");
  }
  const published = await graph("POST", `${GRAPH}/${igUserId}/media_publish`, token, { creation_id: creationId }, deadline);
  const id = idOf(published, "Instagram post");
  return { remoteId: id, url: await permalink(GRAPH, id, token, deadline), note };
}

// ─────────────────────────────────────────────────────────────────────────────
// Threads
// ─────────────────────────────────────────────────────────────────────────────

/** Threads' text limit, counted with threadsLength (emoji count as their UTF-8 bytes). */
export const THREADS_MAX = 500;
// Meta: "wait on average 30 seconds before publishing a Threads media container";
// then check its status (once a minute for up to 5 minutes; we check more often).
// That wait is for the container being published, once; carousel items are
// only polled (together, no first wait).
const THREADS_WAIT = { firstWaitMs: 30_000, everyMs: 10_000, tries: 27 };
const THREADS_ITEM_WAIT = { everyMs: 5_000, tries: 54 };

export async function publishThreads(draft: Draft, token: string, userId: string, deadline = Infinity): Promise<Published> {
  // publish.begin skips stories here; this guards any other caller.
  if (draft.placement === "story") throw new PlatformError(NO_STORIES.threads);
  const length = threadsLength(draft.caption);
  if (length > THREADS_MAX) {
    throw new PlatformError(`The Threads text is ${length} characters as Threads counts them (emoji count as 2-4); the limit is ${THREADS_MAX}.`);
  }
  const chosen = pick(draft.media);
  const create = `${THREADS_GRAPH}/${userId}/threads`;
  let creationId: string;
  let note: string | undefined;
  if (chosen.kind === "none") {
    creationId = idOf(await graph("POST", create, token, { media_type: "TEXT", text: draft.caption }, deadline), "Threads post");
  } else if (chosen.kind === "video") {
    creationId = idOf(
      await graph("POST", create, token, { media_type: "VIDEO", video_url: chosen.video.url, text: draft.caption }, deadline),
      "Threads video",
    );
    note = droppedNote(chosen.dropped, "a video post carries one video");
  } else if (chosen.images.length === 1) {
    creationId = idOf(
      await graph("POST", create, token, { media_type: "IMAGE", image_url: jpegUrl(chosen.images[0].url), text: draft.caption }, deadline),
      "Threads image",
    );
    note = droppedNote(chosen.dropped, "videos don't mix with photos");
  } else {
    const images = chosen.images.slice(0, 20);
    const children: string[] = [];
    for (const image of images) {
      const data = await graph("POST", create, token, { media_type: "IMAGE", image_url: jpegUrl(image.url), is_carousel_item: "true" }, deadline);
      children.push(idOf(data, "Threads carousel item"));
    }
    await Promise.all(
      children.map((child) =>
        waitForContainer(THREADS_GRAPH, child, token, { field: "status", ...THREADS_ITEM_WAIT, label: "A Threads carousel image", deadline }),
      ),
    );
    creationId = idOf(
      await graph("POST", create, token, { media_type: "CAROUSEL", children: children.join(","), text: draft.caption }, deadline),
      "Threads carousel",
    );
    note = droppedNote(chosen.dropped, "videos don't mix with photos");
  }
  await waitForContainer(THREADS_GRAPH, creationId, token, { field: "status", ...THREADS_WAIT, label: "The Threads post", deadline });
  const published = await graph("POST", `${THREADS_GRAPH}/${userId}/threads_publish`, token, { creation_id: creationId }, deadline);
  const id = idOf(published, "Threads post");
  return { remoteId: id, url: await permalink(THREADS_GRAPH, id, token, deadline), note };
}

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn (personal profile)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Commentary in LinkedIn's "little" text format: every reserved character
 * (| { } @ [ ] ( ) < > # \ * _ ~) is escaped with a backslash, except the # of
 * real hashtags (#word after a space or at the start), which stay hashtags.
 */
export function escapeLittle(text: string) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "#") {
      const before = i === 0 ? "" : text[i - 1];
      const startsTag = (before === "" || /[\s([{"'“‘]/u.test(before)) && /[\p{L}\p{N}]/u.test(text[i + 1] ?? "");
      out += startsTag ? "#" : "\\#";
    } else if ("|{}@[]()<>\\*_~".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return out;
}

function linkedinError(data: Json, status: number) {
  const message = typeof data.message === "string" ? data.message : data.raw ? String(data.raw) : "";
  const hint = status === 401 ? " The LinkedIn token is invalid or expired: generate a new one and set LINKEDIN_ACCESS_TOKEN." : "";
  return `HTTP ${status}${message ? `: ${message}` : ""}${hint}`;
}

function linkedinHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Linkedin-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

async function linkedinPost(path: string, token: string, body: unknown, deadline: number) {
  const signal = requestSignal(deadline, "LinkedIn");
  let res: Response;
  try {
    res = await fetch(`${LINKEDIN}${path}`, { method: "POST", headers: linkedinHeaders(token), body: JSON.stringify(body), signal });
  } catch (err) {
    throw new PlatformError(scrub(`Could not reach LinkedIn: ${(err as Error).message}`, token));
  }
  const data = await readJson(res);
  if (!res.ok) throw Object.assign(new PlatformError(scrub(linkedinError(data, res.status), token)), { status: res.status });
  return { data, res };
}

const LINKEDIN_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];

/** Images API: initializeUpload, then PUT the JPEG/PNG bytes (WebP is not accepted). */
async function linkedinImage(url: string, token: string, owner: string, deadline: number) {
  const source = jpegUrl(url);
  let file: Response;
  let bytes: ArrayBuffer;
  try {
    file = await fetch(source, { signal: requestSignal(deadline, "LinkedIn image") });
  } catch (err) {
    throw new PlatformError(`Could not download ${source}: ${(err as Error).message}`);
  }
  if (!file.ok) throw new PlatformError(`Could not download ${source} (HTTP ${file.status}).`);
  const type = (file.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!LINKEDIN_IMAGE_TYPES.includes(type)) {
    throw new PlatformError(`LinkedIn takes JPEG, PNG or GIF images; ${source} is ${type || "of an unknown type"}.`);
  }
  try {
    bytes = await file.arrayBuffer();
  } catch (err) {
    throw new PlatformError(`Could not download ${source}: ${(err as Error).message}`);
  }
  const { data } = await linkedinPost("/rest/images?action=initializeUpload", token, { initializeUploadRequest: { owner } }, deadline);
  const value = data.value as { uploadUrl?: string; image?: string } | undefined;
  if (!value?.uploadUrl || !value.image) throw new PlatformError("LinkedIn did not return an image upload URL.");
  let put: Response;
  try {
    put = await fetch(value.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": type },
      body: bytes,
      signal: requestSignal(deadline, "LinkedIn image upload"),
    });
  } catch (err) {
    throw new PlatformError(scrub(`Could not upload the image to LinkedIn: ${(err as Error).message}`, token));
  }
  if (!put.ok) throw new PlatformError(`LinkedIn refused the image upload (HTTP ${put.status}).`);
  return value.image;
}

export async function publishLinkedin(draft: Draft, token: string, personUrn: string, deadline = Infinity): Promise<Published> {
  if (draft.placement === "story") throw new PlatformError(NO_STORIES.linkedin);
  const chosen = pick(draft.media);
  let note: string | undefined;
  let images = chosen.images;
  if (chosen.kind === "video") {
    // LinkedIn video (Videos API, multipart upload) is not built yet: the first image, else text.
    const first = draft.media.find((m) => m.kind === "image");
    images = first ? [first] : [];
    note = first ? "LinkedIn video isn't supported yet: posted the first image instead." : "LinkedIn video isn't supported yet: posted the text only.";
  } else if (chosen.dropped) {
    note = droppedNote(chosen.dropped, "videos don't mix with photos");
  }
  images = images.slice(0, 20);

  let content: unknown;
  if (images.length > 0) {
    const ids: string[] = [];
    for (const image of images) ids.push(await linkedinImage(image.url, token, personUrn, deadline));
    content = ids.length === 1 ? { media: { id: ids[0] } } : { multiImage: { images: ids.map((id) => ({ id })) } };
  } else if (draft.link) {
    let thumbnail: string | undefined;
    if (draft.thumbnail) {
      try {
        thumbnail = await linkedinImage(draft.thumbnail, token, personUrn, deadline);
      } catch (err) {
        note = `Article posted without a thumbnail: ${(err as Error).message}`;
      }
    }
    content = {
      article: {
        source: draft.link,
        title: draft.title ?? "Shemoqmedi",
        ...(draft.description ? { description: draft.description } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      },
    };
  }

  const body = {
    author: personUrn,
    commentary: escapeLittle(draft.caption),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    ...(content ? { content } : {}),
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  // Uploaded images are processed asynchronously: give them a moment, and
  // retry once when LinkedIn refuses the post (a 4xx means nothing was created).
  if (images.length > 0) await pauseWithin(5_000, deadline, "The LinkedIn post");
  let created: Awaited<ReturnType<typeof linkedinPost>>;
  try {
    created = await linkedinPost("/rest/posts", token, body, deadline);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 0;
    if (images.length === 0 || status < 400 || status >= 500 || [401, 403, 429].includes(status)) throw err;
    await pauseWithin(15_000, deadline, "The LinkedIn post (second try)");
    created = await linkedinPost("/rest/posts", token, body, deadline);
  }
  const urn = created.res.headers.get("x-restli-id") ?? (typeof created.data.id === "string" ? created.data.id : null);
  if (!urn) throw new PlatformError("LinkedIn created the post but returned no id.");
  return { remoteId: urn, url: `https://www.linkedin.com/feed/update/${urn}/`, note };
}
