// Web push helpers shared by convex/push.ts (default runtime) and
// convex/pushSend.ts (Node, where the web-push package runs). Pure functions
// only: no database, no network.

import { ConvexError } from "convex/values";

export type Vapid = { publicKey: string; privateKey: string; subject: string };

/**
 * The VAPID keys from the Convex env (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT), or null while any is missing. Without them push is off:
 * every send is a logged no-op, never an error, so hooks can call it freely.
 */
export function vapidConfig(): Vapid | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** What the service worker (public/sw.js) reads from a push. */
export type PushPayload = { title: string; body: string; url: string; tag?: string };

// Push services cap a payload at about 4 KB after encryption; these limits
// keep well under it whatever a hook passes in.
const TITLE_MAX = 120;
const BODY_MAX = 400;

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * The payload for one device. A relative `url` ("/", "/reminders") opens in
 * the app the device subscribed from; an absolute one opens as given, so a
 * post links to the Studio and a submission to the admin from either app.
 */
export function payloadFor(message: PushPayload, origin: string): string {
  let url: string;
  try {
    url = new URL(message.url, origin).href;
  } catch {
    url = origin;
  }
  const payload: PushPayload = {
    title: clip(message.title, TITLE_MAX) || "Shemoqmedi",
    body: clip(message.body, BODY_MAX),
    url,
  };
  if (message.tag) payload.tag = clip(message.tag, 64);
  return JSON.stringify(payload);
}

/** The push service says the subscription no longer exists: delete it. */
export function isGone(statusCode: number | undefined) {
  return statusCode === 404 || statusCode === 410;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocal(url: URL) {
  return LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
}

function bad(message: string): never {
  throw new ConvexError(message);
}

/** The app origin a device subscribed from: https, or http on a local dev host. */
export function cleanOrigin(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    bad("Invalid app origin.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal(url))) bad("Invalid app origin.");
  return url.origin;
}

/** A push service endpoint: always https. */
export function cleanEndpoint(input: string) {
  const endpoint = input.trim();
  if (endpoint.length > 2048) bad("Invalid push endpoint.");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    bad("Invalid push endpoint.");
  }
  if (url.protocol !== "https:") bad("Invalid push endpoint.");
  return endpoint;
}

/** A subscription key (base64url, as PushSubscription.toJSON() gives it). */
export function cleanKey(input: string, name: string) {
  const key = input.trim();
  if (!key || key.length > 256 || !/^[A-Za-z0-9_-]+=*$/.test(key)) bad(`Invalid push key ${name}.`);
  return key;
}
