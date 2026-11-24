// Reading what Resend actually sent: every email this account's API key sent,
// whichever code path sent it (site emails, juror digests, broadcasts, and
// Gmail "send as" mail through Resend SMTP), with Resend's latest event for
// each (delivered, opened, bounced...). Actions only (fetch).
//
// Needs RESEND_API_KEY with full access: a sending-only key can send but not
// list, and Resend answers 401/403, which comes back as `error`.

import { v } from "convex/values";

const API = "https://api.resend.com";

export const resendRow = v.object({
  id: v.string(),
  to: v.array(v.string()),
  from: v.string(),
  subject: v.string(),
  createdAt: v.number(),
  /** Resend's latest event: queued, sent, delivered, opened, clicked, bounced, complained, failed, delivery_delayed, suppressed, scheduled, canceled. */
  lastEvent: v.union(v.string(), v.null()),
});
export type ResendRow = typeof resendRow.type;

export const resendPage = v.object({
  rows: v.array(resendRow),
  hasMore: v.boolean(),
  error: v.union(v.string(), v.null()),
});
export type ResendPage = typeof resendPage.type;

export const resendEmail = v.object({
  id: v.string(),
  to: v.array(v.string()),
  from: v.string(),
  subject: v.string(),
  createdAt: v.number(),
  lastEvent: v.union(v.string(), v.null()),
  cc: v.array(v.string()),
  bcc: v.array(v.string()),
  replyTo: v.array(v.string()),
  html: v.union(v.string(), v.null()),
  text: v.union(v.string(), v.null()),
});
export type ResendEmail = typeof resendEmail.type;

type Raw = Record<string, unknown>;

/** Resend writes "2026-04-03 22:13:42.674981+00"; Date.parse wants ISO. */
function parseDate(value: unknown) {
  if (typeof value !== "string") return 0;
  const iso = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : typeof value === "string" ? [value] : [];
const str = (value: unknown) => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown) => (typeof value === "string" ? value : null);

function toRow(raw: Raw): ResendRow {
  return {
    id: str(raw.id),
    to: strings(raw.to),
    from: str(raw.from),
    subject: str(raw.subject),
    createdAt: parseDate(raw.created_at),
    lastEvent: strOrNull(raw.last_event),
  };
}

async function call(path: string): Promise<{ data: Raw | null; error: string | null }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { data: null, error: "RESEND_API_KEY is not set on this Convex deployment." };
  try {
    const res = await fetch(`${API}${path}`, {
      // Resend refuses requests without a User-Agent.
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "shemoqmedi-admin" },
    });
    if (res.status === 401 || res.status === 403) {
      return { data: null, error: "Resend refused to list emails: RESEND_API_KEY needs full access, not sending access only." };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { data: null, error: `Resend answered ${res.status}. ${body.slice(0, 200)}`.trim() };
    }
    return { data: (await res.json()) as Raw, error: null };
  } catch (e) {
    return { data: null, error: `Couldn't reach Resend: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** A page of sent emails, newest first. `after` = the last id of the previous page. */
export async function listSent(opts: { limit?: number; after?: string }): Promise<ResendPage> {
  const limit = Math.min(Math.max(Math.round(opts.limit ?? 50), 1), 100);
  const params = new URLSearchParams({ limit: String(limit) });
  if (opts.after) params.set("after", opts.after);
  const { data, error } = await call(`/emails?${params}`);
  if (!data) return { rows: [], hasMore: false, error };
  const list = Array.isArray(data.data) ? (data.data as Raw[]) : [];
  return { rows: list.map(toRow), hasMore: data.has_more === true, error: null };
}

/** One sent email with its body. */
export async function getSent(id: string): Promise<{ email: ResendEmail | null; error: string | null }> {
  if (!/^[\w-]{1,100}$/.test(id)) return { email: null, error: "That isn't a Resend email id." };
  const { data, error } = await call(`/emails/${id}`);
  if (!data) return { email: null, error };
  return {
    email: {
      ...toRow(data),
      cc: strings(data.cc),
      bcc: strings(data.bcc),
      replyTo: strings(data.reply_to),
      html: strOrNull(data.html),
      text: strOrNull(data.text),
    },
    error: null,
  };
}
