import { v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { teamAdmin } from "./lib/teamAuth";
import { memberRole, taskPriority, taskStatus } from "./schema";
import { fail } from "./lib/listingHelpers";
import { cleanBody } from "./guides";

// Team tasks: a Jira-style board. The owner adds team members by name,
// creates tasks (SHQ-1, SHQ-2…) and assigns them; a task can point at the
// guide that explains how to do it, and has a checklist and comments. The
// admin (/tasks) runs it; the docs show it to the team, where each person
// sees "My tasks" (matched by their account email) and moves their own work
// along. Admin-only, like the guides and the docs.

export const TASK_KEY = "SHQ";
export const TASK_LIMITS = { title: 160, description: 10_000, checklist: 40, item: 240, comment: 4000, name: 80, assignees: 10 } as const;

type Status = Infer<typeof taskStatus>;
type Priority = Infer<typeof taskPriority>;

function line(value: string, field: string, max: number, required = true) {
  const text = value.trim().replace(/\s+/g, " ");
  if (required && !text) fail(`${field} is required.`);
  if (text.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return text;
}

function cleanEmail(email: string | undefined) {
  if (email === undefined) return undefined;
  const e = email.trim().toLowerCase();
  if (!e) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) fail("That email doesn't look right.");
  return e;
}

function cleanDue(due: string | undefined) {
  if (due === undefined || due === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`))) fail("The due date must be a date.");
  return due;
}

async function cleanAssignees(ctx: QueryCtx, ids: Id<"teamMembers">[]) {
  const unique = [...new Set(ids)];
  if (unique.length > TASK_LIMITS.assignees) fail(`A task can have up to ${TASK_LIMITS.assignees} people.`);
  for (const id of unique) if (!(await ctx.db.get(id))) fail("One of those people was removed from the team.");
  return unique;
}

function cleanChecklist(items: { id: string; text: string; done: boolean }[]) {
  if (items.length > TASK_LIMITS.checklist) fail(`A checklist can have up to ${TASK_LIMITS.checklist} items.`);
  const seen = new Set<string>();
  return items
    .map((i) => ({ id: i.id.slice(0, 40), text: line(i.text, "A checklist item", TASK_LIMITS.item, false), done: i.done }))
    .filter((i) => i.text && i.id && !seen.has(i.id) && seen.add(i.id));
}

const OPEN: Status[] = ["todo", "in_progress", "review"];
const DONE_SHOWN_DAYS = 30;

/** Every task not done (by status index, bounded). */
async function openTasks(ctx: QueryCtx) {
  const lists = await Promise.all(
    OPEN.map((s) =>
      ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", s))
        .take(1000),
    ),
  );
  return lists.flat();
}

/** Tasks done (or last touched while done) since `since`. */
async function doneSince(ctx: QueryCtx, since: number, limit = 500) {
  return await ctx.db
    .query("tasks")
    .withIndex("by_status", (q) => q.eq("status", "done").gte("updatedAt", since))
    .order("desc")
    .take(limit);
}

async function allMembers(ctx: QueryCtx) {
  return await ctx.db.query("teamMembers").take(200);
}

async function getTask(ctx: QueryCtx, taskId: Id<"tasks">) {
  const task = await ctx.db.get(taskId);
  if (!task) fail("This task was deleted.");
  return task;
}

async function touch(ctx: MutationCtx, task: Doc<"tasks">, patch: Partial<Doc<"tasks">>) {
  const status = patch.status ?? task.status;
  const completedAt = status === "done" ? (task.status === "done" ? task.completedAt : Date.now()) : undefined;
  await ctx.db.patch(task._id, { ...patch, completedAt, updatedAt: Date.now() });
}

// ─── Team members ───────────────────────────────────────────────────────────

const memberOut = v.object({
  id: v.id("teamMembers"),
  name: v.string(),
  role: memberRole,
  email: v.optional(v.string()),
  active: v.boolean(),
  openTasks: v.number(),
});

/** Everyone on the team, active first, with how many open tasks each has. */
export const members = query({
  args: { token: v.optional(v.string()) },
  returns: v.array(memberOut),
  handler: async (ctx, { token }) => {
    await teamAdmin(ctx, token);
    const all = await allMembers(ctx);
    const open = await openTasks(ctx);
    return all
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      .map((m) => ({
        id: m._id,
        name: m.name,
        role: m.role,
        email: m.email,
        active: m.active,
        openTasks: open.filter((t) => t.assigneeIds.includes(m._id)).length,
      }));
  },
});

export const addMember = mutation({
  args: { token: v.optional(v.string()), name: v.string(), role: memberRole, email: v.optional(v.string()) },
  returns: v.id("teamMembers"),
  handler: async (ctx, { token, ...args }) => {
    await teamAdmin(ctx, token);
    const email = cleanEmail(args.email);
    if (email && (await ctx.db.query("teamMembers").withIndex("by_email", (q) => q.eq("email", email)).first())) {
      fail("Someone on the team already has that email.");
    }
    return await ctx.db.insert("teamMembers", {
      name: line(args.name, "Name", TASK_LIMITS.name),
      role: args.role,
      email,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const updateMember = mutation({
  args: { token: v.optional(v.string()),
    memberId: v.id("teamMembers"),
    name: v.optional(v.string()),
    role: v.optional(memberRole),
    email: v.optional(v.string()), // "" clears it
    active: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { token, memberId, ...args }) => {
    await teamAdmin(ctx, token);
    const member = await ctx.db.get(memberId);
    if (!member) fail("That person was removed from the team.");
    const patch: Partial<Doc<"teamMembers">> = {};
    if (args.name !== undefined) patch.name = line(args.name, "Name", TASK_LIMITS.name);
    if (args.role !== undefined) patch.role = args.role;
    if (args.active !== undefined) patch.active = args.active;
    if (args.email !== undefined) {
      const email = cleanEmail(args.email);
      const other = email ? await ctx.db.query("teamMembers").withIndex("by_email", (q) => q.eq("email", email)).first() : null;
      if (other && other._id !== memberId) fail("Someone on the team already has that email.");
      patch.email = email;
    }
    await ctx.db.patch(memberId, patch);
    return null;
  },
});

/** Remove someone from the team; they are taken off every task they were on. */
export const removeMember = mutation({
  args: { token: v.optional(v.string()), memberId: v.id("teamMembers") },
  returns: v.null(),
  handler: async (ctx, { token, memberId }) => {
    await teamAdmin(ctx, token);
    for (const t of [...(await openTasks(ctx)), ...(await doneSince(ctx, 0, 2000))]) {
      if (t.assigneeIds.includes(memberId)) await ctx.db.patch(t._id, { assigneeIds: t.assigneeIds.filter((id) => id !== memberId) });
    }
    await ctx.db.delete(memberId);
    return null;
  },
});

// ─── Tasks ──────────────────────────────────────────────────────────────────

const taskCard = v.object({
  id: v.id("tasks"),
  number: v.number(),
  title: v.string(),
  status: taskStatus,
  priority: taskPriority,
  assignees: v.array(v.object({ id: v.id("teamMembers"), name: v.string() })),
  guide: v.union(v.null(), v.object({ slug: v.string(), title: v.string(), ready: v.boolean() })),
  dueDate: v.optional(v.string()),
  checklistDone: v.number(),
  checklistTotal: v.number(),
  comments: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

async function cardOf(ctx: QueryCtx, t: Doc<"tasks">, names: Map<string, string>) {
  const guide = t.guideId ? await ctx.db.get(t.guideId) : null;
  const comments = await ctx.db
    .query("taskComments")
    .withIndex("by_task", (q) => q.eq("taskId", t._id))
    .collect();
  return {
    id: t._id,
    number: t.number,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignees: t.assigneeIds.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
    guide: guide ? { slug: guide.slug, title: guide.title, ready: guide.status === "ready" } : null,
    dueDate: t.dueDate,
    checklistDone: t.checklist.filter((i) => i.done).length,
    checklistTotal: t.checklist.length,
    comments: comments.length,
    updatedAt: t.updatedAt,
    completedAt: t.completedAt,
  };
}

async function memberNames(ctx: QueryCtx) {
  return new Map<string, string>((await allMembers(ctx)).map((m) => [m._id, m.name]));
}

/**
 * The board: every open task, and tasks done in the last 30 days. `mine`
 * keeps only the tasks of the team member whose email is the viewer's.
 */
export const board = query({
  args: { token: v.optional(v.string()), mine: v.optional(v.boolean()) },
  returns: v.object({ tasks: v.array(taskCard), me: v.union(v.null(), v.object({ id: v.id("teamMembers"), name: v.string() })) }),
  handler: async (ctx, { token, mine }) => {
    const user = await teamAdmin(ctx, token);
    const email = user.email?.trim().toLowerCase();
    const member = email ? await ctx.db.query("teamMembers").withIndex("by_email", (q) => q.eq("email", email)).first() : null;
    const names = await memberNames(ctx);
    const since = Date.now() - DONE_SHOWN_DAYS * 24 * 60 * 60 * 1000;
    const all = [...(await openTasks(ctx)), ...(await doneSince(ctx, since))];
    const shown = mine ? all.filter((t) => member && t.assigneeIds.includes(member._id)) : all;
    return {
      tasks: await Promise.all(shown.map((t) => cardOf(ctx, t, names))),
      me: member ? { id: member._id, name: member.name } : null,
    };
  },
});

/** One task by its number (SHQ-<number>), with its description, checklist and comments; null if there is none. */
export const get = query({
  args: { token: v.optional(v.string()), number: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      card: taskCard,
      description: v.string(),
      assigneeIds: v.array(v.id("teamMembers")),
      checklist: v.array(v.object({ id: v.string(), text: v.string(), done: v.boolean() })),
      createdAt: v.number(),
      createdByName: v.optional(v.string()),
      comments: v.array(v.object({ id: v.id("taskComments"), author: v.string(), mine: v.boolean(), body: v.string(), createdAt: v.number() })),
    }),
  ),
  handler: async (ctx, { token, number }) => {
    const user = await teamAdmin(ctx, token);
    const t = await ctx.db
      .query("tasks")
      .withIndex("by_number", (q) => q.eq("number", number))
      .first();
    if (!t) return null;
    const names = await memberNames(ctx);
    const creator = t.createdBy ? await ctx.db.get(t.createdBy) : null;
    const comments = await ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", t._id))
      .collect();
    return {
      card: await cardOf(ctx, t, names),
      description: t.description,
      assigneeIds: t.assigneeIds,
      checklist: t.checklist,
      createdAt: t.createdAt,
      createdByName: creator?.name ?? undefined,
      comments: await Promise.all(
        comments.map(async (c) => {
          const author = await ctx.db.get(c.authorId);
          return { id: c._id, author: author?.name ?? "Someone", mine: c.authorId === user._id, body: c.body, createdAt: c.createdAt };
        }),
      ),
    };
  },
});

const taskFields = {
  title: v.string(),
  description: v.optional(v.string()),
  priority: v.optional(taskPriority),
  assigneeIds: v.optional(v.array(v.id("teamMembers"))),
  guideId: v.optional(v.union(v.id("guides"), v.null())),
  dueDate: v.optional(v.string()),
  checklist: v.optional(v.array(v.object({ id: v.string(), text: v.string(), done: v.boolean() }))),
};

/** A new task in To do; returns its number. */
export const create = mutation({
  args: { token: v.optional(v.string()), ...taskFields },
  returns: v.number(),
  handler: async (ctx, { token, ...args }) => {
    const user = await teamAdmin(ctx, token);
    if (args.guideId && !(await ctx.db.get(args.guideId))) fail("That guide was deleted.");
    const last = await ctx.db.query("tasks").withIndex("by_number").order("desc").first();
    const number = (last?.number ?? 0) + 1;
    const now = Date.now();
    await ctx.db.insert("tasks", {
      number,
      title: line(args.title, "Title", TASK_LIMITS.title),
      description: cleanBody(args.description ?? ""),
      status: "todo",
      priority: args.priority ?? "normal",
      assigneeIds: await cleanAssignees(ctx, args.assigneeIds ?? []),
      guideId: args.guideId ?? undefined,
      dueDate: cleanDue(args.dueDate),
      checklist: cleanChecklist(args.checklist ?? []),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return number;
  },
});

/** Change any of a task's fields. `guideId: null` unlinks the guide, `dueDate: ""` clears the date. */
export const update = mutation({
  args: { token: v.optional(v.string()), taskId: v.id("tasks"), ...taskFields, title: v.optional(v.string()), status: v.optional(taskStatus) },
  returns: v.null(),
  handler: async (ctx, { token, taskId, ...args }) => {
    await teamAdmin(ctx, token);
    const task = await getTask(ctx, taskId);
    const patch: Partial<Doc<"tasks">> = {};
    if (args.title !== undefined) patch.title = line(args.title, "Title", TASK_LIMITS.title);
    if (args.description !== undefined) patch.description = cleanBody(args.description);
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.assigneeIds !== undefined) patch.assigneeIds = await cleanAssignees(ctx, args.assigneeIds);
    if (args.guideId !== undefined) {
      if (args.guideId && !(await ctx.db.get(args.guideId))) fail("That guide was deleted.");
      patch.guideId = args.guideId ?? undefined;
    }
    if (args.dueDate !== undefined) patch.dueDate = cleanDue(args.dueDate);
    if (args.checklist !== undefined) patch.checklist = cleanChecklist(args.checklist);
    await touch(ctx, task, patch);
    return null;
  },
});

/** Tick or untick one checklist item (what the team does from the docs). */
export const toggleItem = mutation({
  args: { token: v.optional(v.string()), taskId: v.id("tasks"), itemId: v.string(), done: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { token, taskId, itemId, done }) => {
    await teamAdmin(ctx, token);
    const task = await getTask(ctx, taskId);
    if (!task.checklist.some((i) => i.id === itemId)) fail("That checklist item was removed.");
    await touch(ctx, task, { checklist: task.checklist.map((i) => (i.id === itemId ? { ...i, done } : i)) });
    return null;
  },
});

export const remove = mutation({
  args: { token: v.optional(v.string()), taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, { token, taskId }) => {
    await teamAdmin(ctx, token);
    await getTask(ctx, taskId);
    for (const c of await ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect())
      await ctx.db.delete(c._id);
    await ctx.db.delete(taskId);
    return null;
  },
});

export const addComment = mutation({
  args: { token: v.optional(v.string()), taskId: v.id("tasks"), body: v.string() },
  returns: v.id("taskComments"),
  handler: async (ctx, { token, taskId, body }) => {
    const user = await teamAdmin(ctx, token);
    const task = await getTask(ctx, taskId);
    const text = cleanBody(body);
    if (!text) fail("Write something first.");
    if (text.length > TASK_LIMITS.comment) fail(`A comment must be ${TASK_LIMITS.comment} characters or fewer.`);
    const id = await ctx.db.insert("taskComments", { taskId, authorId: user._id, body: text, createdAt: Date.now() });
    await touch(ctx, task, {});
    return id;
  },
});

/** Delete a comment: your own, or any for a super admin. */
export const removeComment = mutation({
  args: { token: v.optional(v.string()), commentId: v.id("taskComments") },
  returns: v.null(),
  handler: async (ctx, { token, commentId }) => {
    const user = await teamAdmin(ctx, token);
    const c = await ctx.db.get(commentId);
    if (!c) return null;
    if (c.authorId !== user._id && user.role !== "super_admin") fail("You can only delete your own comments.");
    await ctx.db.delete(commentId);
    return null;
  },
});

export type { Status as TaskStatus, Priority as TaskPriority };
