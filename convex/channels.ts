// The accounts posts are published to (socialAccounts), seeded from Convex env:
//
//   META_PAGE_ACCESS_TOKEN  Facebook Page token (from a long-lived user token,
//                           so it does not expire); its linked Instagram
//                           Business account is found through the Page.
//   THREADS_ACCESS_TOKEN    long-lived Threads user token (60 days; refreshed
//                           here by the daily cron).
//   LINKEDIN_ACCESS_TOKEN   member token with openid profile w_member_social
//                           (60 days, cannot be refreshed: the admins are
//                           emailed a week before it expires, and when it has).
//
// sync copies a changed env token into the table (compared by sha256) and
// looks up the account ids; unsetting an env var disconnects that network.
// Tokens never leave internal functions: `view` and everything public show
// ids, names, expiry and the last error only.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { accountNetwork } from "./schema";
import { DAY_MS } from "./lib/time";
import { emailHtml, sendEmail } from "./lib/email";
import { IG_LOOKUP_FAILED, linkedinIds, metaIds, refreshThreadsToken, scrub, sha256Hex, threadsIds } from "./lib/socialApi";

type AccountNetwork = Doc<"socialAccounts">["network"];
type Ids = Doc<"socialAccounts">["ids"];

export const ENV_VARS: Record<AccountNetwork, string> = {
  meta: "META_PAGE_ACCESS_TOKEN",
  threads: "THREADS_ACCESS_TOKEN",
  linkedin: "LINKEDIN_ACCESS_TOKEN",
};
const ACCOUNT_NETWORKS: AccountNetwork[] = ["meta", "threads", "linkedin"];

export const TOKEN_LIFETIME_MS = 60 * DAY_MS; // Threads and LinkedIn long-lived tokens
export const THREADS_REFRESH_WITHIN_MS = 20 * DAY_MS;
export const MIN_REFRESH_AGE_MS = DAY_MS;
export const LINKEDIN_WARN_WITHIN_MS = 7 * DAY_MS;

export async function accountOf(ctx: QueryCtx, network: AccountNetwork) {
  return await ctx.db
    .query("socialAccounts")
    .withIndex("by_network", (q) => q.eq("network", network))
    .first();
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeding from env
// ─────────────────────────────────────────────────────────────────────────────

export const seedHashes = internalQuery({
  args: {},
  returns: v.array(v.object({ network: accountNetwork, seedHash: v.string() })),
  handler: async (ctx) => {
    const rows = await ctx.db.query("socialAccounts").take(10);
    return rows.map((r) => ({ network: r.network, seedHash: r.seedHash }));
  },
});

const idsValidator = v.object({
  pageId: v.optional(v.string()),
  pageName: v.optional(v.string()),
  igUserId: v.optional(v.string()),
  igUsername: v.optional(v.string()),
  threadsUserId: v.optional(v.string()),
  threadsUsername: v.optional(v.string()),
  personUrn: v.optional(v.string()),
  name: v.optional(v.string()),
});

/**
 * Replaces a network's row with a freshly seeded token. With `keepIds` (a
 * lookup failed, fully or in part), ids found earlier for the same token are
 * kept, so a passing error doesn't disconnect an account that worked.
 */
export const replaceAccount = internalMutation({
  args: {
    network: accountNetwork,
    token: v.string(),
    seedHash: v.string(),
    issuedAt: v.number(),
    expiresAt: v.optional(v.number()),
    ids: idsValidator,
    lastError: v.optional(v.string()),
    keepIds: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { keepIds, ...args }) => {
    const old = await ctx.db
      .query("socialAccounts")
      .withIndex("by_network", (q) => q.eq("network", args.network))
      .collect();
    const same = keepIds ? old.find((row) => row.token === args.token) : undefined;
    const found = Object.fromEntries(Object.entries(args.ids).filter(([, value]) => value !== undefined)) as Ids;
    const ids = same ? { ...same.ids, ...found } : found;
    // A kept row also keeps its issue time and expiry (and a refreshed Threads token's).
    const times = same
      ? {
          issuedAt: same.issuedAt,
          ...(same.expiresAt !== undefined ? { expiresAt: same.expiresAt } : {}),
          ...(same.refreshedAt !== undefined ? { refreshedAt: same.refreshedAt } : {}),
          ...(same.warnedSoonAt !== undefined ? { warnedSoonAt: same.warnedSoonAt } : {}),
          ...(same.warnedExpiredAt !== undefined ? { warnedExpiredAt: same.warnedExpiredAt } : {}),
        }
      : {};
    for (const row of old) await ctx.db.delete(row._id);
    await ctx.db.insert("socialAccounts", { ...args, ...times, ids, updatedAt: Date.now() });
    return null;
  },
});

export const removeAccount = internalMutation({
  args: { network: accountNetwork },
  returns: v.null(),
  handler: async (ctx, { network }) => {
    const rows = await ctx.db
      .query("socialAccounts")
      .withIndex("by_network", (q) => q.eq("network", network))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return null;
  },
});

/** The account's ids; `partialError` when some were found and some not (Meta: the Page but not its Instagram). */
async function lookup(network: AccountNetwork, token: string): Promise<{ ids: Ids; partialError?: string }> {
  if (network === "meta") return await metaIds(token);
  if (network === "threads") return { ids: await threadsIds(token) };
  return { ids: await linkedinIds(token) };
}

/**
 * Copies changed env tokens into socialAccounts and looks up their ids. Runs
 * before every publish, from list_channels and daily; it calls the platforms
 * only when a token changed (or its last lookup failed).
 */
export const sync = internalAction({
  args: {},
  returns: v.object({ changed: v.array(accountNetwork), removed: v.array(accountNetwork) }),
  handler: async (ctx): Promise<{ changed: AccountNetwork[]; removed: AccountNetwork[] }> => {
    const stored: { network: AccountNetwork; seedHash: string }[] = await ctx.runQuery(internal.channels.seedHashes, {});
    const changed: AccountNetwork[] = [];
    const removed: AccountNetwork[] = [];
    for (const network of ACCOUNT_NETWORKS) {
      const token = process.env[ENV_VARS[network]]?.trim();
      const row = stored.find((s) => s.network === network);
      if (!token) {
        if (row) {
          await ctx.runMutation(internal.channels.removeAccount, { network });
          removed.push(network);
        }
        continue;
      }
      const hash = await sha256Hex(token);
      if (row?.seedHash === hash) continue;
      const issuedAt = Date.now();
      // Meta Page tokens made from a long-lived user token don't expire. The
      // Threads expiry is an estimate until the first refresh tells the truth.
      const expiresAt = network === "meta" ? undefined : issuedAt + TOKEN_LIFETIME_MS;
      try {
        const { ids, partialError } = await lookup(network, token);
        // A partial lookup (Meta: the Page was found, its Instagram wasn't) keeps
        // what it found and is stored without its hash, so the next sync tries again.
        await ctx.runMutation(internal.channels.replaceAccount, {
          network,
          token,
          seedHash: partialError ? "" : hash,
          issuedAt,
          expiresAt,
          ids,
          ...(partialError ? { lastError: scrub(partialError, token), keepIds: true } : {}),
        });
      } catch (err) {
        // Stored without its hash, so the next sync looks it up again.
        const lastError = scrub(`Account lookup failed: ${(err as Error).message}`, token);
        await ctx.runMutation(internal.channels.replaceAccount, { network, token, seedHash: "", issuedAt, expiresAt, ids: {}, lastError, keepIds: true });
      }
      changed.push(network);
    }
    return { changed, removed };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// What is connected (no tokens)
// ─────────────────────────────────────────────────────────────────────────────

export const channelView = v.object({
  network: v.union(v.literal("facebook"), v.literal("instagram"), v.literal("threads"), v.literal("linkedin")),
  connected: v.boolean(),
  account: v.union(v.string(), v.null()),
  envVar: v.string(),
  expiresAt: v.union(v.number(), v.null()),
  lastError: v.union(v.string(), v.null()),
  updatedAt: v.union(v.number(), v.null()),
});
export type ChannelView = typeof channelView.type;

/** The four publishing networks and whether each can be posted to. Never includes a token. */
export async function channelsOf(ctx: QueryCtx): Promise<ChannelView[]> {
  const meta = await accountOf(ctx, "meta");
  const threads = await accountOf(ctx, "threads");
  const linkedin = await accountOf(ctx, "linkedin");
  const now = Date.now();
  const common = (row: Doc<"socialAccounts"> | null, network: AccountNetwork) => ({
    envVar: ENV_VARS[network],
    expiresAt: row?.expiresAt ?? null,
    lastError: row?.lastError ?? null,
    updatedAt: row?.updatedAt ?? null,
  });
  const linkedinExpired = !!linkedin?.expiresAt && linkedin.expiresAt <= now;
  return [
    {
      network: "facebook",
      connected: !!meta?.ids.pageId,
      account: meta?.ids.pageName ?? meta?.ids.pageId ?? null,
      ...common(meta, "meta"),
      // An Instagram-only lookup error doesn't concern the Page.
      lastError: meta?.lastError && !meta.lastError.startsWith(IG_LOOKUP_FAILED) ? meta.lastError : null,
    },
    {
      network: "instagram",
      connected: !!meta?.ids.igUserId,
      account: meta?.ids.igUsername ? `@${meta.ids.igUsername}` : (meta?.ids.igUserId ?? null),
      ...common(meta, "meta"),
      lastError: meta?.lastError ?? (meta?.ids.pageId && !meta.ids.igUserId ? "No Instagram Business account is linked to this Facebook Page." : null),
    },
    {
      network: "threads",
      connected: !!threads?.ids.threadsUserId,
      account: threads?.ids.threadsUsername ? `@${threads.ids.threadsUsername}` : (threads?.ids.threadsUserId ?? null),
      ...common(threads, "threads"),
    },
    {
      network: "linkedin",
      connected: !!linkedin?.ids.personUrn && !linkedinExpired,
      account: linkedin?.ids.name ?? linkedin?.ids.personUrn ?? null,
      ...common(linkedin, "linkedin"),
      lastError: linkedin?.lastError ?? (linkedinExpired ? "The LinkedIn token expired: generate a new one and set LINKEDIN_ACCESS_TOKEN." : null),
    },
  ];
}

export const view = internalQuery({
  args: {},
  returns: v.array(channelView),
  handler: async (ctx) => channelsOf(ctx),
});

export const setLastError = internalMutation({
  args: { network: accountNetwork, error: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { network, error }) => {
    const row = await accountOf(ctx, network);
    if (row) await ctx.db.patch(row._id, { lastError: error ?? undefined, updatedAt: Date.now() });
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Daily: Threads refresh, LinkedIn expiry emails
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Threads token is refreshed when it is at least 24 hours old and expires
 * within 20 days, or when it has never been refreshed (its expiry is then
 * only an estimate from when it was set, so the first refresh pins it down).
 */
export function threadsRefreshDue(row: Pick<Doc<"socialAccounts">, "issuedAt" | "expiresAt" | "refreshedAt">, now: number) {
  if (now - row.issuedAt < MIN_REFRESH_AGE_MS) return false;
  if (row.expiresAt !== undefined && row.expiresAt <= now) return false; // expired tokens can't be refreshed
  if (row.refreshedAt === undefined) return true;
  return row.expiresAt === undefined || row.expiresAt - now <= THREADS_REFRESH_WITHIN_MS;
}

export const threadsForRefresh = internalQuery({
  args: {},
  returns: v.union(v.object({ token: v.string(), due: v.boolean() }), v.null()),
  handler: async (ctx) => {
    const row = await accountOf(ctx, "threads");
    if (!row || !row.ids.threadsUserId) return null;
    return { token: row.token, due: threadsRefreshDue(row, Date.now()) };
  },
});

export const saveRefreshedThreads = internalMutation({
  args: { token: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { token, expiresAt }) => {
    const row = await accountOf(ctx, "threads");
    if (!row) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, { token, expiresAt, issuedAt: now, refreshedAt: now, lastError: undefined, updatedAt: now });
    return null;
  },
});

export const refreshThreads = internalAction({
  args: {},
  returns: v.union(v.literal("refreshed"), v.literal("not_due"), v.literal("failed"), v.literal("none")),
  handler: async (ctx): Promise<"refreshed" | "not_due" | "failed" | "none"> => {
    const row: { token: string; due: boolean } | null = await ctx.runQuery(internal.channels.threadsForRefresh, {});
    if (!row) return "none";
    if (!row.due) return "not_due";
    try {
      const fresh = await refreshThreadsToken(row.token);
      await ctx.runMutation(internal.channels.saveRefreshedThreads, { token: fresh.token, expiresAt: Date.now() + fresh.expiresInMs });
      return "refreshed";
    } catch (err) {
      await ctx.runMutation(internal.channels.setLastError, {
        network: "threads",
        error: scrub(`Token refresh failed: ${(err as Error).message}`, row.token),
      });
      return "failed";
    }
  },
});

export const linkedinExpiry = internalQuery({
  args: {},
  returns: v.union(
    v.object({ expiresAt: v.number(), warnedSoon: v.boolean(), warnedExpired: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const row = await accountOf(ctx, "linkedin");
    if (!row?.expiresAt) return null;
    return { expiresAt: row.expiresAt, warnedSoon: !!row.warnedSoonAt, warnedExpired: !!row.warnedExpiredAt };
  },
});

export const markLinkedinWarned = internalMutation({
  args: { kind: v.union(v.literal("soon"), v.literal("expired")) },
  returns: v.null(),
  handler: async (ctx, { kind }) => {
    const row = await accountOf(ctx, "linkedin");
    if (!row) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, kind === "soon" ? { warnedSoonAt: now } : { warnedExpiredAt: now, warnedSoonAt: row.warnedSoonAt ?? now });
    return null;
  },
});

const LINKEDIN_HOWTO =
  "Open https://www.linkedin.com/developers/tools/oauth/token-generator, pick the Shemoqmedi app, tick openid, profile and w_member_social (the same scopes as before), copy the token and run: npx convex env set LINKEDIN_ACCESS_TOKEN <token> (on the prod deployment).";

/** Emails the admins once when the LinkedIn token has 7 days or less, and once when it expired. */
export const warnLinkedin = internalAction({
  args: {},
  returns: v.union(v.literal("soon"), v.literal("expired"), v.null()),
  handler: async (ctx): Promise<"soon" | "expired" | null> => {
    const info: { expiresAt: number; warnedSoon: boolean; warnedExpired: boolean } | null = await ctx.runQuery(
      internal.channels.linkedinExpiry,
      {},
    );
    if (!info) return null;
    const now = Date.now();
    let kind: "soon" | "expired" | null = null;
    if (info.expiresAt <= now) kind = info.warnedExpired ? null : "expired";
    else if (info.expiresAt - now <= LINKEDIN_WARN_WITHIN_MS) kind = info.warnedSoon ? null : "soon";
    if (!kind) return null;
    const days = Math.max(0, Math.ceil((info.expiresAt - now) / DAY_MS));
    const subject =
      kind === "expired"
        ? "The LinkedIn token expired: posts can't go to LinkedIn"
        : `The LinkedIn token expires in ${days} day${days === 1 ? "" : "s"}`;
    const lead =
      kind === "expired"
        ? "The LinkedIn access token has expired. Until it is replaced, approved posts still go out to Facebook, Instagram and Threads, but LinkedIn fails on every post with a LinkedIn caption, so those posts show as failed. Replace the token, then retry them: only LinkedIn is sent again."
        : `The LinkedIn access token expires on ${new Date(info.expiresAt).toUTCString()}. LinkedIn tokens can't be refreshed automatically.`;
    const to: string[] = await ctx.runQuery(internal.notify.adminEmails, {});
    const error = await sendEmail({ to, subject, text: `${lead}\n\n${LINKEDIN_HOWTO}`, html: emailHtml([lead, LINKEDIN_HOWTO]) });
    if (error) {
      console.warn(`LinkedIn token warning not sent: ${error}`);
      return null;
    }
    await ctx.runMutation(internal.channels.markLinkedinWarned, { kind });
    return kind;
  },
});

/** Cron (daily): pick up env changes, refresh Threads, warn about LinkedIn. */
export const daily = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runAction(internal.channels.sync, {});
    await ctx.runAction(internal.channels.refreshThreads, {});
    await ctx.runAction(internal.channels.warnLinkedin, {});
    return null;
  },
});
