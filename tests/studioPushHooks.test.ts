/// <reference types="vite/client" />
// The Studio's push hooks on the social desk: one push per queueing run,
// the morning digest, a post published or failed, and token warnings.
// web-push and the networks (fetch) are mocked: nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { digestBody } from "../convex/social";
import { postLink } from "../convex/publish";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification } }));

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const DAY = 24 * 60 * 60 * 1000;
const STUDIO = "https://studio.shemoqmedi.space";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-12T08:00:00Z"));
  vi.stubEnv("VAPID_PUBLIC_KEY", "test-public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "test-private-key");
  vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
  vi.stubEnv("RESEND_API_KEY", "");
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { externalId: "admin", name: "Giorgi", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now });
  });
  const admin = t.withIdentity({ subject: "admin" });
  await admin.mutation(api.push.subscribe, {
    endpoint: "https://fcm.googleapis.com/fcm/send/phone",
    keys: { p256dh: "BPkey", auth: "auth" },
    origin: STUDIO,
    userAgent: "Mozilla/5.0 (iPhone)",
  });
  return { t, admin };
}
type Env = Awaited<ReturnType<typeof setup>>;

const drain = (env: Env) => env.t.finishAllScheduledFunctions(vi.runAllTimers);
const sent = () =>
  sendNotification.mock.calls.map(([, payload]) => JSON.parse(payload as string) as { title: string; body: string; url: string; tag?: string });

let n = 0;
async function site(env: Env) {
  n += 1;
  const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  return await env.admin.mutation(api.admin.createListing, {
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
}

describe("queueing", () => {
  it("pushes once per run that queued posts, linking the Studio queue", async () => {
    const env = await setup();
    const a = await site(env);
    const b = await site(env);
    await drain(env);
    sendNotification.mockClear();

    expect(await env.t.mutation(internal.social.queueNewListings, {})).toBe(2);
    await drain(env);
    const titles = await env.t.run(async (ctx) => [(await ctx.db.get(a.id))!.title, (await ctx.db.get(b.id))!.title]);
    expect(sent()).toEqual([
      {
        title: "2 new posts are waiting",
        body: `New listing: ${titles[0]}, New listing: ${titles[1]}`,
        url: `${STUDIO}/queue`,
        tag: "social-queue",
      },
    ]);

    // A run that queues nothing stays silent.
    sendNotification.mockClear();
    expect(await env.t.mutation(internal.social.queueNewListings, {})).toBe(0);
    await drain(env);
    expect(sent()).toEqual([]);
  });

  it("pushes the weekly calls and the roundup once each", async () => {
    const env = await setup();
    await site(env);
    await drain(env);
    sendNotification.mockClear();

    expect(await env.t.mutation(internal.social.queueCall, { kind: "call_submissions" })).not.toBeNull();
    expect(await env.t.mutation(internal.social.queueCall, { kind: "call_submissions" })).toBeNull(); // already this week
    expect(await env.t.mutation(internal.social.queueRoundup, {})).not.toBeNull();
    await drain(env);
    expect(sent()).toEqual([
      { title: "A post is waiting", body: "Call for submissions", url: `${STUDIO}/queue`, tag: "social-queue" },
      { title: "A post is waiting", body: "Weekly roundup (1 new, 0 awards)", url: `${STUDIO}/queue`, tag: "social-queue" },
    ]);
  });

  it("the morning digest pushes what is waiting, alongside the email", async () => {
    const env = await setup();
    await env.t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("socialPosts", { kind: "announcement", status: "waiting", facts: {}, media: [], createdAt: Date.now() + i });
      }
    });
    await env.t.action(internal.social.waitingPing, {});
    await drain(env);
    expect(sent()).toEqual([
      {
        title: "5 posts are waiting",
        body: "Announcement, Announcement, Announcement and 2 more",
        url: `${STUDIO}/queue`,
        tag: "social-queue",
      },
    ]);

    // Nothing waiting: no email, no push.
    sendNotification.mockClear();
    await env.t.run(async (ctx) => {
      for (const p of await ctx.db.query("socialPosts").collect()) await ctx.db.patch(p._id, { status: "rejected" });
    });
    await env.t.action(internal.social.waitingPing, {});
    await drain(env);
    expect(sent()).toEqual([]);
  });

  it("digestBody lists three and counts the rest", () => {
    expect(digestBody(["A"], 1)).toBe("A");
    expect(digestBody(["A", "B", "C"], 3)).toBe("A, B, C");
    expect(digestBody(["A", "B", "C", "D"], 4)).toBe("A, B, C and 1 more");
    expect(digestBody(["A", "B", "C"], 40)).toBe("A, B, C and 37 more");
  });
});

describe("publishing", () => {
  async function finished(env: Env, results: { network: "facebook" | "instagram"; status: "sent" | "failed"; error?: string }[], listing = true) {
    const listingId = listing ? (await site(env)).id : undefined;
    await drain(env);
    sendNotification.mockClear();
    const id: Id<"socialPosts"> = await env.t.run((ctx) =>
      ctx.db.insert("socialPosts", {
        kind: "new_listing",
        listingId,
        status: "approved",
        facts: {},
        media: [],
        captions: { facebook: "FB", instagram: "IG" },
        results: results.map((r) => ({ ...r, at: Date.now() })),
        createdAt: Date.now(),
      }),
    );
    const status = await env.t.mutation(internal.publish.finish, { postId: id });
    await drain(env);
    return { id, status };
  }

  it("a sent post pushes where it went, linking the post in the Studio queue", async () => {
    const env = await setup();
    const { id, status } = await finished(env, [
      { network: "facebook", status: "sent" },
      { network: "instagram", status: "sent" },
    ]);
    expect(status).toBe("sent");
    const [push] = sent();
    expect(push).toEqual({
      title: expect.stringMatching(/^Published: New listing: Site \d+$/),
      body: "On Facebook, Instagram",
      url: `${STUDIO}/queue?post=${id}`,
      tag: `post-${id}`,
    });
    expect(sent()).toHaveLength(1);
    expect(postLink(id)).toBe(`${STUDIO}/queue?post=${id}`);
  });

  it("a failed post pushes the error and what did go out", async () => {
    const env = await setup();
    const { id, status } = await finished(
      env,
      [
        { network: "facebook", status: "sent" },
        { network: "instagram", status: "failed", error: "Media URL unreachable" },
      ],
      false,
    );
    expect(status).toBe("failed");
    expect(sent()).toEqual([
      {
        title: "Failed: New listing",
        body: "Instagram: Media URL unreachable · Sent: Facebook",
        url: `${STUDIO}/queue?post=${id}`,
        tag: `post-${id}`,
      },
    ]);
  });
});

describe("token warnings", () => {
  async function account(env: Env, network: "threads" | "linkedin", fields: { issuedAt: number; expiresAt: number }) {
    await env.t.run((ctx) =>
      ctx.db.insert("socialAccounts", {
        network,
        token: `${network}-token-secret-123456`,
        seedHash: "x",
        ids: network === "threads" ? { threadsUserId: "1" } : { personUrn: "urn:li:person:1" },
        updatedAt: Date.now(),
        ...fields,
      }),
    );
  }

  it("a LinkedIn token about to expire pushes once, like the email", async () => {
    const env = await setup();
    await account(env, "linkedin", { issuedAt: Date.now() - 55 * DAY, expiresAt: Date.now() + 5 * DAY });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No email provider here, so the email isn't sent (and repeats tomorrow); the push still goes out.
    expect(await env.t.action(internal.channels.warnLinkedin, {})).toBeNull();
    warn.mockRestore();
    await drain(env);
    expect(sent()).toEqual([
      {
        title: "The LinkedIn token expires in 5 days",
        body: "LinkedIn tokens can't be refreshed automatically. The email has the steps.",
        url: `${STUDIO}/`,
        tag: "token-linkedin",
      },
    ]);
  });

  it("a failed Threads refresh pushes without the error or the token", async () => {
    const env = await setup();
    await account(env, "threads", { issuedAt: Date.now() - 50 * DAY, expiresAt: Date.now() + 10 * DAY });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Session has expired", type: "OAuthException", code: 190 } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    expect(await env.t.action(internal.channels.refreshThreads, {})).toBe("failed");
    await drain(env);
    expect(sent()).toEqual([
      {
        title: "The Threads token refresh failed",
        body: "Posts to Threads may stop when it expires. Channels in the Studio show the error.",
        url: `${STUDIO}/`,
        tag: "token-threads",
      },
    ]);
    expect(JSON.stringify(sendNotification.mock.calls)).not.toContain("threads-token-secret");
  });
});
