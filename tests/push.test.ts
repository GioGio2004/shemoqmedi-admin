/// <reference types="vite/client" />
// Web push (convex/push.ts, pushSend.ts) and reminders (convex/reminders.ts):
// device subscriptions, fan-out to admins, dead subscription cleanup, the
// hooks that push, reminders firing, and who may do what. web-push is mocked:
// nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { payloadFor } from "../convex/lib/push";
import { isStudioHost } from "../lib/hosts";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification } }));

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const HOUR = 60 * 60 * 1000;

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
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const user = (externalId: string, name: string, role?: "admin" | "super_admin") =>
      ctx.db.insert("users", { externalId, name, email: `${externalId}@example.com`, role, createdAt: now, updatedAt: now });
    return {
      admin: await user("admin", "Giorgi", "admin"),
      boss: await user("boss", "Boss", "super_admin"),
      member: await user("member", "Member"),
    };
  });
  return {
    t,
    ids,
    admin: t.withIdentity({ subject: "admin" }),
    boss: t.withIdentity({ subject: "boss" }),
    member: t.withIdentity({ subject: "member" }),
  };
}
type Env = Awaited<ReturnType<typeof setup>>;

let n = 0;
/** A browser subscription as PushSubscription.toJSON() gives it. */
function device(origin = "https://studio.shemoqmedi.space") {
  n += 1;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    keys: { p256dh: `BPkey${n}`, auth: `auth${n}` },
    origin,
    userAgent: "Mozilla/5.0 (iPhone)",
  };
}

const subscriptions = (env: Env) => env.t.run((ctx) => ctx.db.query("pushSubscriptions").collect());
const drain = (env: Env) => env.t.finishAllScheduledFunctions(vi.runAllTimers);
/** The parsed payloads web-push was asked to send, with their endpoints. */
const sent = () =>
  sendNotification.mock.calls.map(([sub, payload]) => ({
    endpoint: (sub as { endpoint: string }).endpoint,
    ...(JSON.parse(payload as string) as { title: string; body: string; url: string; tag?: string }),
  }));

describe("subscriptions", () => {
  it("are for admins only and kept one row per endpoint", async () => {
    const env = await setup();
    const phone = device();
    await expect(env.t.mutation(api.push.subscribe, phone)).rejects.toThrow(/Unauthenticated/);
    await expect(env.member.mutation(api.push.subscribe, phone)).rejects.toThrow(/admin role required/);
    await expect(env.member.query(api.push.mySubscriptions, {})).rejects.toThrow(/admin role required/);

    await env.admin.mutation(api.push.subscribe, phone);
    // Subscribing again (a refreshed page) updates the row instead of adding one.
    await env.admin.mutation(api.push.subscribe, { ...phone, keys: { p256dh: "BPnew", auth: "authnew" } });
    const rows = await subscriptions(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: env.ids.admin, origin: "https://studio.shemoqmedi.space", keys: { p256dh: "BPnew" } });

    // Each admin sees only their own devices.
    await env.boss.mutation(api.push.subscribe, device("https://admin.shemoqmedi.space"));
    expect(await env.admin.query(api.push.mySubscriptions, {})).toEqual([
      expect.objectContaining({ endpoint: phone.endpoint, lastOkAt: null }),
    ]);
  });

  it("rejects endpoints and origins that are not https (except local development)", async () => {
    const env = await setup();
    await expect(env.admin.mutation(api.push.subscribe, { ...device(), endpoint: "http://push.example/x" })).rejects.toThrow(/endpoint/);
    await expect(env.admin.mutation(api.push.subscribe, device("javascript:alert(1)"))).rejects.toThrow(/origin/);
    await expect(env.admin.mutation(api.push.subscribe, device("http://evil.example"))).rejects.toThrow(/origin/);
    await expect(env.admin.mutation(api.push.subscribe, { ...device(), keys: { p256dh: "<script>", auth: "a" } })).rejects.toThrow(/key/);
    await env.admin.mutation(api.push.subscribe, device("http://studio.localhost:3000/some/page"));
    expect((await subscriptions(env))[0].origin).toBe("http://studio.localhost:3000");
  });

  it("can only be removed by their owner", async () => {
    const env = await setup();
    const phone = device();
    await env.admin.mutation(api.push.subscribe, phone);
    await env.member.mutation(api.push.unsubscribe, { endpoint: phone.endpoint });
    await env.boss.mutation(api.push.unsubscribe, { endpoint: phone.endpoint });
    expect(await subscriptions(env)).toHaveLength(1);
    await env.admin.mutation(api.push.unsubscribe, { endpoint: phone.endpoint });
    expect(await subscriptions(env)).toHaveLength(0);
  });
});

describe("notifyAdmins", () => {
  it("fans out to every current admin's devices, resolving relative links per app", async () => {
    const env = await setup();
    const studio = device("https://studio.shemoqmedi.space");
    const admin = device("https://admin.shemoqmedi.space");
    const boss = device("https://admin.shemoqmedi.space");
    await env.admin.mutation(api.push.subscribe, studio);
    await env.admin.mutation(api.push.subscribe, admin);
    await env.boss.mutation(api.push.subscribe, boss);
    // A device of someone who is no longer an admin gets nothing.
    const former = device();
    await env.t.run((ctx) => ctx.db.insert("pushSubscriptions", { ...former, userId: env.ids.member, createdAt: Date.now() }));

    const result = await env.t.action(internal.push.notifyAdmins, { title: "Hello", body: "World", url: "/queue", tag: "t" });
    expect(result).toEqual({ configured: true, sent: 3, removed: 0, failed: 0 });
    expect(sent()).toEqual(
      expect.arrayContaining([
        { endpoint: studio.endpoint, title: "Hello", body: "World", url: "https://studio.shemoqmedi.space/queue", tag: "t" },
        { endpoint: admin.endpoint, title: "Hello", body: "World", url: "https://admin.shemoqmedi.space/queue", tag: "t" },
        { endpoint: boss.endpoint, title: "Hello", body: "World", url: "https://admin.shemoqmedi.space/queue", tag: "t" },
      ]),
    );
    expect(sent().map((s) => s.endpoint)).not.toContain(former.endpoint);
    // VAPID details go with each send.
    expect(sendNotification.mock.calls[0][2]).toMatchObject({
      vapidDetails: { publicKey: "test-public-key", privateKey: "test-private-key", subject: "mailto:admin@example.com" },
    });
    // Devices that took the push are marked.
    const rows = await subscriptions(env);
    expect(rows.filter((r) => r.userId !== env.ids.member).map((r) => typeof r.lastOkAt)).toEqual(["number", "number", "number"]);

    // An absolute link opens as given, in whichever app.
    sendNotification.mockClear();
    await env.t.action(internal.push.notifyAdmins, { title: "Post", body: "x", url: "https://studio.shemoqmedi.space/queue" });
    expect(new Set(sent().map((s) => s.url))).toEqual(new Set(["https://studio.shemoqmedi.space/queue"]));
  });

  it("deletes subscriptions the push service says are gone (404/410) and keeps the rest", async () => {
    const env = await setup();
    const [gone, expired, flaky, fine] = [device(), device(), device(), device()];
    for (const d of [gone, expired, flaky, fine]) await env.admin.mutation(api.push.subscribe, d);
    sendNotification.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
      const status = { [gone.endpoint]: 410, [expired.endpoint]: 404, [flaky.endpoint]: 500 }[endpoint];
      if (status) throw Object.assign(new Error("Received unexpected response code"), { statusCode: status });
      return { statusCode: 201 };
    });

    const result = await env.t.action(internal.push.notifyAdmins, { title: "Hi", body: "", url: "/" });
    expect(result).toEqual({ configured: true, sent: 1, removed: 2, failed: 1 });
    const left = (await subscriptions(env)).map((r) => r.endpoint).sort();
    expect(left).toEqual([flaky.endpoint, fine.endpoint].sort());
  });

  it("is a logged no-op without the VAPID env vars", async () => {
    const env = await setup();
    await env.admin.mutation(api.push.subscribe, device());
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await env.t.action(internal.push.notifyAdmins, { title: "Hi", body: "", url: "/" });
    expect(result).toEqual({ configured: false, sent: 0, removed: 0, failed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Push skipped"));
    log.mockRestore();
  });

  it("test sends only to the caller's devices, and only for admins", async () => {
    const env = await setup();
    const mine = device();
    await env.admin.mutation(api.push.subscribe, mine);
    await env.boss.mutation(api.push.subscribe, device());
    await expect(env.member.action(api.push.test, {})).rejects.toThrow(/admin role required/);
    await expect(env.t.action(api.push.test, {})).rejects.toThrow(/Unauthenticated/);
    expect(await env.admin.action(api.push.test, {})).toMatchObject({ configured: true, sent: 1 });
    expect(sent()).toEqual([expect.objectContaining({ endpoint: mine.endpoint, url: "https://studio.shemoqmedi.space/" })]);
  });
});

describe("payloads", () => {
  it("clip long text and fall back to the app's home for a bad link", () => {
    const payload = JSON.parse(payloadFor({ title: "T".repeat(300), body: "B ".repeat(500), url: "http://[bad" }, "https://admin.shemoqmedi.space"));
    expect(payload.title.length).toBeLessThanOrEqual(120);
    expect(payload.body.length).toBeLessThanOrEqual(400);
    expect(payload.url).toBe("https://admin.shemoqmedi.space");
  });

  it("tell the Studio host apart", () => {
    expect(isStudioHost("studio.shemoqmedi.space")).toBe(true);
    expect(isStudioHost("Studio.Shemoqmedi.Space:443")).toBe(true);
    expect(isStudioHost("studio.localhost:3000")).toBe(true);
    expect(isStudioHost("admin.shemoqmedi.space")).toBe(false);
    expect(isStudioHost("localhost:3000")).toBe(false);
    expect(isStudioHost(null)).toBe(false);
  });
});

describe("reminders", () => {
  it("fire as a push to their owner's devices at their time", async () => {
    const env = await setup();
    const phone = device();
    await env.admin.mutation(api.push.subscribe, phone);
    await env.boss.mutation(api.push.subscribe, device());

    const at = Date.now() + 2 * HOUR;
    const reminder = await env.admin.mutation(api.reminders.create, { text: "  Post the  SOTD reel ", at });
    expect(reminder).toMatchObject({ text: "Post the SOTD reel", at });
    expect(await env.admin.query(api.reminders.list, {})).toEqual([reminder]);

    // Not before its time.
    vi.advanceTimersByTime(HOUR);
    expect(sendNotification).not.toHaveBeenCalled();

    vi.setSystemTime(at + 1000);
    await drain(env);
    expect(sent()).toEqual([
      {
        endpoint: phone.endpoint,
        title: "Reminder",
        body: "Post the SOTD reel",
        url: "https://studio.shemoqmedi.space/reminders",
        tag: `reminder-${reminder.id}`,
      },
    ]);
    expect(await env.admin.query(api.reminders.list, {})).toEqual([]);
    const row = await env.t.run((ctx) => ctx.db.get(reminder.id));
    expect(row).toMatchObject({ done: true });
  });

  it("are cancelled when removed, and only their owner can remove them", async () => {
    const env = await setup();
    await env.admin.mutation(api.push.subscribe, device());
    const reminder = await env.admin.mutation(api.reminders.create, { text: "Call the jury", at: Date.now() + HOUR });
    await expect(env.boss.mutation(api.reminders.remove, { id: reminder.id })).rejects.toThrow(/not found/);
    await env.admin.mutation(api.reminders.remove, { id: reminder.id });
    vi.setSystemTime(Date.now() + 2 * HOUR);
    await drain(env);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await env.t.run((ctx) => ctx.db.get(reminder.id))).toBeNull();
  });

  it("are for admins, with sensible text and times", async () => {
    const env = await setup();
    const at = Date.now() + HOUR;
    await expect(env.member.mutation(api.reminders.create, { text: "x", at })).rejects.toThrow(/admin role required/);
    await expect(env.member.query(api.reminders.list, {})).rejects.toThrow(/admin role required/);
    await expect(env.admin.mutation(api.reminders.create, { text: "   ", at })).rejects.toThrow(/required/);
    await expect(env.admin.mutation(api.reminders.create, { text: "x".repeat(201), at })).rejects.toThrow(/200/);
    await expect(env.admin.mutation(api.reminders.create, { text: "late", at: Date.now() - HOUR })).rejects.toThrow(/future/);
    await expect(env.admin.mutation(api.reminders.create, { text: "far", at: Date.now() + 400 * 24 * HOUR })).rejects.toThrow(/year/);
    // Upcoming reminders come soonest first.
    await env.admin.mutation(api.reminders.create, { text: "later", at: at + HOUR });
    await env.admin.mutation(api.reminders.create, { text: "sooner", at });
    expect((await env.admin.query(api.reminders.list, {})).map((r) => r.text)).toEqual(["sooner", "later"]);
    expect(await env.boss.query(api.reminders.list, {})).toEqual([]);
  });
});

describe("hooks", () => {
  async function storeFile(env: Env) {
    return env.t.run((ctx) => ctx.storage.store(new Blob(["bytes"], { type: "image/png" })));
  }

  it("a new submission pushes a link to its review page", async () => {
    const env = await setup();
    await env.admin.mutation(api.push.subscribe, device("https://admin.shemoqmedi.space"));
    await env.member.mutation(api.listings.submit, {
      title: "Paper Weather",
      tagline: "A forecast you can fold.",
      url: "paperweather.studio/",
      category: "portfolio",
      technologies: ["Next.js"],
      creatorTier: "solo",
      region: "georgia",
      creditName: "Fold & Co.",
      submissionTier: "standard",
      coverId: await storeFile(env),
    });
    await drain(env);
    const [listing] = await env.t.run((ctx) => ctx.db.query("listings").collect());
    expect(sent()).toEqual([
      expect.objectContaining({
        title: "New submission",
        body: "Paper Weather by Fold & Co.",
        url: `https://admin.shemoqmedi.space/review/${listing._id}`,
      }),
    ]);
  });

  it("a new claim pushes a link to the claims page", async () => {
    const env = await setup();
    await env.admin.mutation(api.push.subscribe, device("https://admin.shemoqmedi.space"));
    const coverId = await storeFile(env);
    const { slug } = await env.admin.mutation(api.admin.createListing, {
      title: "Unclaimed Site",
      tagline: "A site",
      url: "https://unclaimed.example",
      categories: ["portfolio"],
      technologies: [],
      region: "global",
      creatorTier: "agency",
      creditName: "Some Studio",
      coverId,
      status: "in_voting",
      isClaimed: false,
    });
    await drain(env);
    sendNotification.mockClear();
    await env.member.mutation(api.claims.submit, { targetType: "listing", slug, message: "It's ours, see the footer." });
    await drain(env);
    expect(sent()).toEqual([
      expect.objectContaining({ title: "New claim", body: "Member claims Unclaimed Site", url: "https://admin.shemoqmedi.space/claims" }),
    ]);
  });

  it("an empty day and a round without a winner push to the admins", async () => {
    const env = await setup();
    await env.admin.mutation(api.push.subscribe, device("https://admin.shemoqmedi.space"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await env.t.action(internal.notify.emptyDay, { day: "2026-11-12" });
    const roundId: Id<"rounds"> = await env.t.run((ctx) =>
      ctx.db.insert("rounds", { kind: "SOTM", period: "2026-10", candidates: [], opensAt: 0, closesAt: 1, announceAt: 2, status: "announced", createdAt: 0 }),
    );
    await env.t.action(internal.notify.noRoundWinner, { roundId });
    await drain(env);
    warn.mockRestore();
    expect(sent().map((s) => s.title)).toEqual(["No Site of the Day for 12 Nov 2026", "No Site of the Month for 2026-10"]);
    expect(sent().every((s) => s.url === "https://admin.shemoqmedi.space/awards")).toBe(true);
  });
});
