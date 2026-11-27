/// <reference types="vite/client" />
// Team tasks (convex/tasks.ts): admin-only, numbered SHQ-1.., assigned to
// team members, "my tasks" by account email, checklist, comments, done dates.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { mintServiceCredential } from "../convex/lib/tokens";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { externalId: "giorgi", name: "Giorgi", email: "giorgi@example.com", role: "super_admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("users", { externalId: "dima", name: "Dima", email: "Dima@Example.com", role: "admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("users", { externalId: "guest", name: "Guest", email: "guest@example.com", createdAt: now, updatedAt: now });
  });
  return {
    t,
    giorgi: t.withIdentity({ subject: "giorgi" }),
    dima: t.withIdentity({ subject: "dima" }),
    guest: t.withIdentity({ subject: "guest" }),
  };
}

describe("tasks", () => {
  it("is admin-only", async () => {
    const { guest } = await setup();
    await expect(guest.query(api.tasks.board, {})).rejects.toThrow(/admin/);
    await expect(guest.mutation(api.tasks.addMember, { name: "X", role: "ops" })).rejects.toThrow(/admin/);
  });

  it("manages team members", async () => {
    const { giorgi } = await setup();
    const dima = await giorgi.mutation(api.tasks.addMember, { name: " Dima ", role: "ops", email: "DIMA@example.com" });
    await expect(giorgi.mutation(api.tasks.addMember, { name: "Other", role: "ops", email: "dima@example.com" })).rejects.toThrow(/already has that email/);
    await expect(giorgi.mutation(api.tasks.addMember, { name: "Bad", role: "ops", email: "nope" })).rejects.toThrow(/email/);
    const saba = await giorgi.mutation(api.tasks.addMember, { name: "Saba", role: "developer" });
    await giorgi.mutation(api.tasks.updateMember, { memberId: saba, active: false });
    const list = await giorgi.query(api.tasks.members, {});
    expect(list.map((m) => [m.name, m.email, m.active])).toEqual([
      ["Dima", "dima@example.com", true],
      ["Saba", undefined, false],
    ]);
    expect(dima).toBeTruthy();
  });

  it("numbers tasks, assigns them and shows each person theirs", async () => {
    const { giorgi, dima } = await setup();
    const dimaId = await giorgi.mutation(api.tasks.addMember, { name: "Dima", role: "ops", email: "dima@example.com" });
    const sabaId = await giorgi.mutation(api.tasks.addMember, { name: "Saba", role: "developer" });
    const a = await giorgi.mutation(api.tasks.create, { title: "Invite 20 Product Hunt makers", assigneeIds: [dimaId, dimaId], priority: "high", dueDate: "2026-12-01" });
    const b = await giorgi.mutation(api.tasks.create, { title: "Fix the video upload", assigneeIds: [sabaId] });
    expect([a, b]).toEqual([1, 2]);
    await expect(giorgi.mutation(api.tasks.create, { title: "x", dueDate: "tomorrow" })).rejects.toThrow(/due date/);

    const all = await giorgi.query(api.tasks.board, {});
    expect(all.tasks).toHaveLength(2);
    expect(all.me).toBeNull(); // Giorgi isn't on the team list
    const mine = await dima.query(api.tasks.board, { mine: true });
    expect(mine.me?.name).toBe("Dima");
    expect(mine.tasks.map((t) => [t.number, t.priority, t.dueDate, t.assignees.map((x) => x.name)])).toEqual([[1, "high", "2026-12-01", ["Dima"]]]);

    // Removing someone takes them off their tasks.
    await giorgi.mutation(api.tasks.removeMember, { memberId: sabaId });
    expect((await giorgi.query(api.tasks.get, { number: 2 }))!.assigneeIds).toEqual([]);
  });

  it("moves through statuses, keeps the done date, ticks the checklist", async () => {
    const { giorgi, dima } = await setup();
    const n = await giorgi.mutation(api.tasks.create, {
      title: "Log 10 leads",
      checklist: [
        { id: "a", text: "Find 10 sites", done: false },
        { id: "b", text: "  ", done: false },
        { id: "a", text: "duplicate", done: false },
        { id: "c", text: "Add them to the Listings tab", done: false },
      ],
    });
    const task = (await giorgi.query(api.tasks.get, { number: n }))!;
    expect(task.checklist.map((i) => i.id)).toEqual(["a", "c"]);
    expect(task.card.status).toBe("todo");

    await dima.mutation(api.tasks.toggleItem, { taskId: task.card.id, itemId: "a", done: true });
    await dima.mutation(api.tasks.update, { taskId: task.card.id, status: "done" });
    let after = (await giorgi.query(api.tasks.get, { number: n }))!;
    expect(after.card.checklistDone).toBe(1);
    const doneAt = after.card.completedAt;
    expect(doneAt).toBeTypeOf("number");
    await dima.mutation(api.tasks.update, { taskId: task.card.id, title: "Log 10 leads today" });
    after = (await giorgi.query(api.tasks.get, { number: n }))!;
    expect(after.card.completedAt).toBe(doneAt); // still done: same date
    await dima.mutation(api.tasks.update, { taskId: task.card.id, status: "in_progress" });
    expect((await giorgi.query(api.tasks.get, { number: n }))!.card.completedAt).toBeUndefined();
  });

  it("links a guide, and keeps the task when the guide is deleted", async () => {
    const { giorgi } = await setup();
    const slug = await giorgi.mutation(api.guides.create, { title: "Jury invites", area: "networking", roles: ["ops"] });
    const guide = (await giorgi.query(api.guides.get, { slug }))!;
    const n = await giorgi.mutation(api.tasks.create, { title: "Send 5 invites", guideId: guide.id });
    expect((await giorgi.query(api.tasks.get, { number: n }))!.card.guide).toEqual({ slug, title: "Jury invites", ready: false });
    await giorgi.mutation(api.guides.remove, { guideId: guide.id });
    expect((await giorgi.query(api.tasks.get, { number: n }))!.card.guide).toBeNull();
  });

  it("takes comments; only the author (or a super admin) deletes one", async () => {
    const { giorgi, dima } = await setup();
    const n = await giorgi.mutation(api.tasks.create, { title: "Post the listing" });
    const id = (await giorgi.query(api.tasks.get, { number: n }))!.card.id;
    await expect(dima.mutation(api.tasks.addComment, { taskId: id, body: "  " })).rejects.toThrow(/Write something/);
    const c = await dima.mutation(api.tasks.addComment, { taskId: id, body: "Done the first 3.\n\n\n\nStuck on the 4th." });
    const g = await giorgi.mutation(api.tasks.addComment, { taskId: id, body: "Ok" });
    const task = (await dima.query(api.tasks.get, { number: n }))!;
    expect(task.comments.map((x) => [x.author, x.mine, x.body])).toEqual([
      ["Dima", true, "Done the first 3.\n\nStuck on the 4th."],
      ["Giorgi", false, "Ok"],
    ]);
    await expect(dima.mutation(api.tasks.removeComment, { commentId: g })).rejects.toThrow(/your own/);
    await giorgi.mutation(api.tasks.removeComment, { commentId: c });
    await giorgi.mutation(api.tasks.remove, { taskId: id });
    expect(await giorgi.query(api.tasks.get, { number: n })).toBeNull();
  });
});

describe("guides and tasks through the MCP connector's credential", () => {
  beforeEach(() => vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("works with an admin's credential and refuses anyone else's or a forged one", async () => {
    const { t } = await setup(); // no session identity: the token alone decides
    const admin = (await mintServiceCredential("giorgi"))!;
    const guest = (await mintServiceCredential("guest"))!;

    const slug = await t.mutation(api.guides.create, { token: admin, title: "Call prep", area: "networking", roles: ["owner"] });
    const guide = (await t.query(api.guides.get, { token: admin, slug }))!;
    expect(guide).toMatchObject({ status: "draft", updatedByName: "Giorgi" });
    const n = await t.mutation(api.tasks.create, { token: admin, title: "Prepare the call", guideId: guide.id });
    expect((await t.query(api.tasks.board, { token: admin })).tasks.map((x) => x.number)).toEqual([n]);

    await expect(t.query(api.guides.list, { token: guest })).rejects.toThrow(/Not signed in to Shemoqmedi as an admin/);
    await expect(t.mutation(api.tasks.create, { token: "forged", title: "x" })).rejects.toThrow(/Not signed in/);
    await expect(t.query(api.tasks.board, {})).rejects.toThrow(/Unauthenticated/);
  });
});
