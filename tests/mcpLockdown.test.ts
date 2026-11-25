/// <reference types="vite/client" />
// The MCP connector's human gate (audit C-04, B-15): send_broadcast,
// approve_post, publish_post and retry_post only create a pending action, and
// nothing reaches Resend or a social network until an admin approves it with
// a Clerk session (once). send_email is the exception (Giorgi's choice, 24 Nov
// 2026): with confirm it sends at once, after his yes to the exact preview in
// chat, and is recorded as a pending action approved in chat. Daily caps hold when Claude
// asks and when an admin approves. Every tool call is logged in mcpAudit with
// emails and tokens redacted. Award posts need a valid award of a site that
// isn't the team's. MCP_OAUTH_AUDIENCE fails closed in production.
// fetch is stubbed: nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mintServiceCredential } from "../convex/lib/tokens";
import { MCP_DAILY_CAPS, PENDING_ACTION_TTL_MS } from "../convex/lib/config";
import { summarizeArgs } from "../convex/lib/mcpAudit";
import { auditTools, type AuditEntry } from "../lib/mcp/audit";
import { clientAllowed, oauthAudience } from "../lib/mcp/oauth";
import { describePending } from "../lib/pendingActions";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const META = "EAAG-meta-page-token-1234567890";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-19T08:00:00Z"));
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("RESEND_API_KEY", "re_test_not_a_real_key");
  vi.stubEnv("SOCIAL_WAIT_SCALE", "0");
  vi.stubEnv("META_PAGE_ACCESS_TOKEN", "");
  vi.stubEnv("THREADS_ACCESS_TOKEN", "");
  vi.stubEnv("LINKEDIN_ACCESS_TOKEN", "");
  // Every outside call answers OK and is counted: the tests assert who was called, and when.
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.resend.com/emails/batch")) return Response.json({ data: [] });
    if (url.includes("api.resend.com")) return Response.json({ id: "email1" });
    return Response.json({ id: "x" });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const calls = (host: string) => fetchMock.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes(host));

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { externalId: "admin", name: "Giorgi Admin", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("users", { externalId: "member", name: "Member", email: "member@example.com", createdAt: now, updatedAt: now });
  });
  const admin = t.withIdentity({ subject: "admin" });
  const member = t.withIdentity({ subject: "member" });
  const token = (await mintServiceCredential("admin"))!;
  return { t, admin, member, token };
}
type Env = Awaited<ReturnType<typeof setup>>;
const drain = (env: Env) => env.t.finishAllScheduledFunctions(vi.runAllTimers);
const pending = (env: Env) => env.t.run((ctx) => ctx.db.query("pendingActions").collect());
const emailLog = (env: Env) => env.t.run((ctx) => ctx.db.query("emailLog").collect());

let n = 0;
async function site(env: Env, contactEmail = "hello@studio.example") {
  n += 1;
  const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const { id, slug } = await env.admin.mutation(api.admin.createListing, {
    title: `Site ${n}`,
    tagline: "A site",
    url: `https://site-${n}.example`,
    categories: ["portfolio"],
    technologies: [],
    region: "global",
    creatorTier: "agency",
    creditName: `Studio ${n}`,
    coverId,
    status: "in_voting",
    isClaimed: false,
  });
  const creatorId = (await env.t.run((ctx) => ctx.db.get(id)))!.creatorId!;
  await env.admin.mutation(api.admin.updateCreator, { id: creatorId, contactEmail });
  return { id, slug };
}

async function facebookPost(env: Env, caption = "Hello Facebook") {
  const view = await env.t.mutation(api.mcp.createPost, { token: env.token, kind: "custom", facts: { title: "News" }, captions: { facebook: caption } });
  return view.id as Id<"socialPosts">;
}

async function award(env: Env, listingId: Id<"listings">, slug: string, status: "active" | "revoked" = "active") {
  return await env.t.run((ctx) =>
    ctx.db.insert("awards", {
      listingId,
      tier: "SOTD",
      period: "2026-11-18",
      date: "2026-11-18",
      score: 7.4,
      slug,
      status,
      source: "manual",
      reason: "test",
      createdAt: Date.now(),
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("MCP send and publish only ask", () => {
  it("send_email previews without confirm; with confirm it sends once and is logged as approved in chat", async () => {
    const env = await setup();
    const s = await site(env);
    const args = { token: env.token, listingSlug: s.slug, subject: "Your site", body: "Hi! Claim it: {claimLink}" };

    // Without confirm: only the preview, nothing sent or recorded.
    const preview = await env.t.action(api.mcp.sendEmail, { ...args, confirm: false });
    expect(preview).toMatchObject({ sent: false, to: "hello@studio.example", subject: "Your site" });
    expect(preview.text).toMatch(/\/claim\//);
    await drain(env);
    expect(calls("api.resend.com")).toHaveLength(0);
    expect(await pending(env)).toHaveLength(0);

    // With confirm (Giorgi said yes in chat): sent once, right away.
    const sent = await env.t.action(api.mcp.sendEmail, { ...args, confirm: true });
    expect(sent).toMatchObject({ sent: true, status: "sent", to: "hello@studio.example" });
    await drain(env);
    expect(calls("api.resend.com/emails")).toHaveLength(1);
    const log = await emailLog(env);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ to: "hello@studio.example", subject: "Your site", status: "sent" });

    // Recorded as approved in chat, with exactly what went out.
    const [row] = await pending(env);
    expect(row).toMatchObject({ _id: sent.pendingActionId, kind: "send_email", status: "approved" });
    expect(row.payload).toMatchObject({ to: "hello@studio.example", subject: "Your site", text: sent.text });
    expect(row.result).toMatchObject({ status: "sent", approvedIn: "chat" });

    // An admin approving that row again sends nothing more; a member can't touch it.
    await expect(env.member.mutation(api.pendingActions.approve, { id: row._id })).rejects.toThrow(/admin/);
    expect(await env.admin.mutation(api.pendingActions.approve, { id: row._id })).toMatchObject({ executed: false });
    await drain(env);
    expect(calls("api.resend.com/emails")).toHaveLength(1);
  });

  it("send_broadcast creates a pending action; approval starts the broadcast once", async () => {
    const env = await setup();
    await site(env, "one@studio.example");
    await site(env, "two@studio.example");
    const asked = await env.t.action(api.mcp.sendBroadcast, { token: env.token, audience: "studios", subject: "News", body: "Hello", confirm: true });
    expect(asked).toMatchObject({ started: false, recipients: 2 });
    await drain(env);
    expect(calls("api.resend.com")).toHaveLength(0);

    const [row] = await env.admin.query(api.pendingActions.list, {});
    expect(describePending(row).confirm).toMatch(/about 2 people/);
    await env.admin.mutation(api.pendingActions.approve, { id: asked.pendingActionId! });
    await env.admin.mutation(api.pendingActions.approve, { id: asked.pendingActionId! });
    await drain(env);
    expect(calls("api.resend.com/emails/batch")).toHaveLength(1);
    expect((await emailLog(env)).map((e) => e.to).sort()).toEqual(["one@studio.example", "two@studio.example"]);
  });

  it("approve_post and publish_post never publish; the admin's approval does, once", async () => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", META);
    const env = await setup();
    const id = await facebookPost(env);
    const asked = await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    expect(asked).toMatchObject({ status: "pending", summary: expect.stringContaining("facebook") });
    const later = await env.t.mutation(api.mcp.publishPost, { token: env.token, id, at: Date.now() + 3_600_000 });
    expect(later.status).toBe("pending");
    await drain(env);
    expect(calls("graph.facebook.com")).toHaveLength(0);
    const post = await env.t.run((ctx) => ctx.db.get(id));
    expect(post).toMatchObject({ status: "waiting" });
    expect(post!.publishJobId).toBeUndefined();

    await env.admin.mutation(api.pendingActions.approve, { id: asked.pendingActionId });
    const scheduled = (await env.t.run((ctx) => ctx.db.get(id)))!;
    expect(scheduled).toMatchObject({ status: "scheduled", publishRun: 1 });
    // Again: a no-op, no second run.
    expect(await env.admin.mutation(api.pendingActions.approve, { id: asked.pendingActionId })).toMatchObject({ executed: false });
    expect((await env.t.run((ctx) => ctx.db.get(id)))!.publishRun).toBe(1);
    // Rejecting the other request changes nothing on the post.
    expect(await env.admin.mutation(api.pendingActions.reject, { id: later.pendingActionId })).toMatchObject({ status: "rejected" });
    expect(await env.admin.mutation(api.pendingActions.approve, { id: later.pendingActionId })).toMatchObject({ status: "rejected", executed: false });
    expect((await env.t.run((ctx) => ctx.db.get(id)))!).toMatchObject({ status: "scheduled", publishRun: 1 });
  });

  it("refuses at approval a post that was edited after Claude asked", async () => {
    const env = await setup();
    const id = await facebookPost(env, "Shown to Giorgi");
    const asked = await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { facebook: "Swapped afterwards" } });
    const [row] = await env.admin.query(api.pendingActions.list, {});
    expect(row.changed).toBe(true);
    await expect(env.admin.mutation(api.pendingActions.approve, { id: asked.pendingActionId })).rejects.toThrow(/changed after Claude asked/);
    expect((await env.t.run((ctx) => ctx.db.get(id)))!.status).toBe("waiting");
  });

  it("checks the post when Claude asks, like approval does", async () => {
    const env = await setup();
    const view = await env.t.mutation(api.mcp.createPost, { token: env.token, kind: "custom", facts: {} });
    await expect(env.t.mutation(api.mcp.approvePost, { token: env.token, id: view.id })).rejects.toThrow(/at least one caption/);
    await expect(env.t.mutation(api.mcp.retryPost, { token: env.token, id: view.id })).rejects.toThrow(/approve it first/);
    expect(await pending(env)).toHaveLength(0);
  });

  it("a request expires after its time and can't be approved then", async () => {
    const env = await setup();
    const id = await facebookPost(env);
    const asked = await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    vi.setSystemTime(Date.now() + PENDING_ACTION_TTL_MS + 1000);
    expect(await env.admin.query(api.pendingActions.list, {})).toHaveLength(0);
    expect(await env.admin.mutation(api.pendingActions.approve, { id: asked.pendingActionId })).toMatchObject({ status: "expired", executed: false });
    expect((await env.t.run((ctx) => ctx.db.get(id)))!.status).toBe("waiting");
  });
});

describe("daily caps", () => {
  it("caps the emails Claude can send in 24 hours", async () => {
    const env = await setup();
    let token = env.token;
    const send = () => env.t.action(api.mcp.sendEmail, { token, to: "someone@studio.example", subject: "Hi", body: "Hello", confirm: true });
    for (let i = 0; i < MCP_DAILY_CAPS.emails; i++) await send();
    await expect(send()).rejects.toThrow(/Daily limit reached/);
    await drain(env);
    expect(calls("api.resend.com/emails")).toHaveLength(MCP_DAILY_CAPS.emails);
    expect(await pending(env)).toHaveLength(MCP_DAILY_CAPS.emails);
    // A day later the cap starts again.
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    token = (await mintServiceCredential("admin"))!; // the agent's credential lives a minute
    await send();
  });

  it("allows one broadcast a day", async () => {
    const env = await setup();
    await site(env, "one@studio.example");
    const send = () => env.t.action(api.mcp.sendBroadcast, { token: env.token, audience: "studios", subject: "News", body: "Hello", confirm: true });
    await send();
    await expect(send()).rejects.toThrow(/at most 1 broadcasts/);
  });

  it("caps post publishes when Claude asks and again when an admin approves", async () => {
    const env = await setup();
    const ids: Id<"socialPosts">[] = [];
    for (let i = 0; i <= MCP_DAILY_CAPS.posts; i++) ids.push(await facebookPost(env, `Post ${i}`));
    const asks = [];
    for (let i = 0; i < MCP_DAILY_CAPS.posts; i++) asks.push(await env.t.mutation(api.mcp.approvePost, { token: env.token, id: ids[i] }));
    await expect(env.t.mutation(api.mcp.approvePost, { token: env.token, id: ids[MCP_DAILY_CAPS.posts] })).rejects.toThrow(/Daily limit reached/);

    // Approve them all, then one more request that slipped in (an older row, asked yesterday): over the cap at approval.
    for (const a of asks) await env.admin.mutation(api.pendingActions.approve, { id: a.pendingActionId });
    const extra = ids[MCP_DAILY_CAPS.posts];
    const post = (await env.t.run((ctx) => ctx.db.get(extra)))!;
    const userId = (await env.t.run((ctx) => ctx.db.query("users").first()))!._id;
    const stale = await env.t.run((ctx) =>
      ctx.db.insert("pendingActions", {
        kind: "publish_post",
        payload: {
          postId: extra,
          mode: "approve",
          title: "News",
          snapshot: { captions: { facebook: post.captions!.facebook! }, media: [], placement: "feed", scheduledFor: null, networks: ["facebook"] },
        },
        summary: "Publish",
        requestedBy: userId,
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
        status: "pending",
      }),
    );
    await expect(env.admin.mutation(api.pendingActions.approve, { id: stale })).rejects.toThrow(/Daily limit reached/);
    expect((await env.t.run((ctx) => ctx.db.get(extra)))!.status).toBe("waiting");
  });
});

describe("mcpAudit", () => {
  it("logs every tool call once, with emails and tokens redacted", async () => {
    const env = await setup();
    const s = await site(env);
    const entries: AuditEntry[] = [];
    type Cb = (...params: unknown[]) => Promise<unknown>;
    const tools = new Map<string, Cb>();
    const server = { registerTool: (name: string, _config: unknown, cb: Cb) => void tools.set(name, cb) };
    auditTools(server, async (entry) => {
      entries.push(entry);
      await env.t.mutation(api.mcp.logCall, entry);
    });
    // As lib/mcp/server.ts registers them: (args, ctx), or (ctx) for tools without input.
    server.registerTool("send_email", {}, async (args: unknown, ctx: unknown) => {
      const token = (ctx as { http: { authInfo: { token: string } } }).http.authInfo.token;
      const { to, subject, body } = args as { to: string; subject: string; body: string };
      const out = await env.t.action(api.mcp.sendEmail, { token, to, subject, body, confirm: true });
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    });
    server.registerTool("whoami", {}, async () => ({ content: [{ type: "text", text: "me" }] }));
    server.registerTool("get_listing", {}, async () => ({ isError: true, content: [{ type: "text", text: "No listing for hello@studio.example" }] }));
    server.registerTool("crash", {}, async () => {
      throw new Error("boom");
    });
    const ctx = { http: { authInfo: { token: env.token } } };

    await tools.get("send_email")!({ to: "outreach@other.example", subject: "Hello there", body: "Long body ".repeat(50), apiKey: "re_live_abcdefgh12345" }, ctx);
    await tools.get("whoami")!(ctx);
    await tools.get("get_listing")!({ slug: s.slug }, ctx);
    await expect(tools.get("crash")!({}, ctx)).rejects.toThrow("boom");

    const rows = await env.t.run((ctx) => ctx.db.query("mcpAudit").collect());
    expect(rows.map((r) => [r.tool, r.outcome])).toEqual([
      ["send_email", "ok"],
      ["whoami", "ok"],
      ["get_listing", "error"],
      ["crash", "error"],
    ]);
    const admin = (await env.t.run((c) => c.db.query("users").first()))!;
    expect(rows.every((r) => r.userId === admin._id)).toBe(true);
    const all = JSON.stringify(rows);
    expect(all).not.toContain("outreach@other.example");
    expect(all).not.toContain("hello@studio.example");
    expect(all).not.toContain("re_live_abcdefgh12345");
    expect(all).not.toContain(env.token);
    expect(rows[0].args).toContain("[email]");
    expect(rows[0].args).toContain('"apiKey":"[redacted]"');
    expect(rows[0].args.length).toBeLessThanOrEqual(501);
    expect(rows[3].error).toContain("boom");
    // The tool's own work happened as well: a pending action, nothing sent.
    expect(await pending(env)).toHaveLength(1);
    expect(entries).toHaveLength(4);
  });

  it("a call with a bad credential is logged without a user; a failed log never fails the tool", async () => {
    const env = await setup();
    await env.t.mutation(api.mcp.logCall, { token: "svc.forged.token", tool: "whoami", args: {}, outcome: "error", error: "Not signed in" });
    const [row] = await env.t.run((ctx) => ctx.db.query("mcpAudit").collect());
    expect(row.userId).toBeUndefined();

    const tools = new Map<string, (...p: unknown[]) => Promise<unknown>>();
    // registerTool is replaced on the object passed in, so tools register through it.
    const server = { registerTool: (name: string, _c: unknown, cb: (...p: unknown[]) => Promise<unknown>) => void tools.set(name, cb) };
    auditTools(server, async () => {
      throw new Error("Convex is down");
    });
    server.registerTool("whoami", {}, async () => ({ content: [{ type: "text", text: "me" }] }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await tools.get("whoami")!({ http: { authInfo: { token: "x" } } })).toMatchObject({ content: [{ text: "me" }] });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("summarizeArgs redacts and shortens", () => {
    const out = summarizeArgs({
      to: "a.person@example.com",
      token: "anything",
      body: `write to x@y.io now ${"z".repeat(200)}`,
      key: "svc.eyJ1IjoiYSJ9.c2lnbmF0dXJl",
      nested: { password: "hunter2", list: Array.from({ length: 30 }, (_, i) => i) },
    });
    expect(out).not.toMatch(/a\.person@example\.com|x@y\.io|hunter2|svc\.eyJ/);
    expect(out).toContain('"token":"[redacted]"');
    expect(out).toContain("…20 more");
    expect(out.length).toBeLessThanOrEqual(501);
  });
});

describe("award posts (B-15)", () => {
  it("need a valid, active award of a site that isn't the team's", async () => {
    const env = await setup();
    const s = await site(env);
    const base = { token: env.token, kind: "award" as const };
    await expect(env.t.mutation(api.mcp.createPost, base)).rejects.toThrow(/needs awardSlug/);
    await expect(env.t.mutation(api.mcp.createPost, { ...base, listingSlug: s.slug })).rejects.toThrow(/needs awardSlug/);
    await expect(env.t.mutation(api.mcp.createPost, { ...base, awardSlug: "no-such-award" })).rejects.toThrow(/No award/);
    await award(env, s.id, "site-revoked", "revoked");
    await expect(env.t.mutation(api.mcp.createPost, { ...base, awardSlug: "site-revoked" })).rejects.toThrow(/not active/);

    const awardId = await award(env, s.id, "site-sotd");
    const other = await site(env);
    await expect(env.t.mutation(api.mcp.createPost, { ...base, awardSlug: "site-sotd", listingSlug: other.slug })).rejects.toThrow(/belongs to/);
    const ok = await env.t.mutation(api.mcp.createPost, { ...base, awardSlug: "site-sotd" });
    expect(await env.t.run((ctx) => ctx.db.get(ok.id as Id<"socialPosts">))).toMatchObject({ kind: "award", awardId, listingId: s.id });

    // awardSlug on another kind is a mistake, not ignored.
    await expect(env.t.mutation(api.mcp.createPost, { token: env.token, kind: "custom", awardSlug: "site-sotd" })).rejects.toThrow(/only for award posts/);
  });

  it("are refused for a team site", async () => {
    const env = await setup();
    const s = await site(env);
    await award(env, s.id, "team-sotd");
    await env.t.run((ctx) => ctx.db.patch(s.id, { byTeam: true }));
    await expect(env.t.mutation(api.mcp.createPost, { token: env.token, kind: "award", awardSlug: "team-sotd" })).rejects.toThrow(/team sites are never awarded/);
    expect(await env.t.run((ctx) => ctx.db.query("socialPosts").collect())).toHaveLength(0);
  });
});

describe("MCP OAuth audience", () => {
  it("fails closed in production when MCP_OAUTH_AUDIENCE is unset", () => {
    expect(oauthAudience({ NODE_ENV: "production" })).toMatchObject({ ok: false, reason: expect.stringContaining("MCP_OAUTH_AUDIENCE") });
    expect(oauthAudience({ NODE_ENV: "production", MCP_OAUTH_AUDIENCE: " https://admin.shemoqmedi.space/api/mcp " })).toEqual({
      ok: true,
      audience: "https://admin.shemoqmedi.space/api/mcp",
    });
    expect(oauthAudience({ NODE_ENV: "development" })).toEqual({ ok: true });
    expect(oauthAudience({ NODE_ENV: "test" })).toEqual({ ok: true });
  });

  it("MCP_OAUTH_CLIENT_IDS limits which OAuth clients may connect", () => {
    expect(clientAllowed("client_a", {})).toBe(true);
    expect(clientAllowed(undefined, {})).toBe(true);
    expect(clientAllowed("client_a", { MCP_OAUTH_CLIENT_IDS: "client_a, client_b" })).toBe(true);
    expect(clientAllowed("client_c", { MCP_OAUTH_CLIENT_IDS: "client_a, client_b" })).toBe(false);
    expect(clientAllowed(undefined, { MCP_OAUTH_CLIENT_IDS: "client_a" })).toBe(false);
  });
});
