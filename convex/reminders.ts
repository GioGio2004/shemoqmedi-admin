// "Remind me at …": an admin writes a line and a time (the Studio's Reminders
// tab) and gets it as a push on their own devices at that time. Each
// reminder is one scheduled reminders.fire job; removing it cancels the job.

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./authHelpers";
import { cleanText, fail } from "./lib/listingHelpers";
import { studioUrl } from "../lib/hosts";

const TEXT_MAX = 200;
// A little slack for a phone clock that runs behind ("in 1 minute" may
// arrive a moment late); further in the past is a mistake.
const PAST_SLACK_MS = 5 * 60 * 1000;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_UPCOMING = 100;

const reminderView = v.object({ id: v.id("reminders"), text: v.string(), at: v.number() });

export const create = mutation({
  args: { text: v.string(), at: v.number() },
  returns: reminderView,
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const text = cleanText(args.text, "Reminder", TEXT_MAX);
    const now = Date.now();
    if (!Number.isFinite(args.at) || args.at < now - PAST_SLACK_MS) fail("Pick a time in the future.");
    if (args.at > now + MAX_AHEAD_MS) fail("Pick a time within a year.");

    const waiting = await ctx.db
      .query("reminders")
      .withIndex("by_user_done_at", (q) => q.eq("userId", user._id).eq("done", false))
      .take(MAX_UPCOMING);
    if (waiting.length >= MAX_UPCOMING) fail(`You have ${MAX_UPCOMING} reminders waiting already.`);

    const at = Math.max(args.at, now);
    const id = await ctx.db.insert("reminders", { userId: user._id, text, at, done: false, createdAt: now });
    const jobId = await ctx.scheduler.runAt(at, internal.reminders.fire, { id });
    await ctx.db.patch(id, { jobId });
    return { id, text, at };
  },
});

/** The signed-in admin's reminders that haven't fired yet, soonest first. */
export const list = query({
  args: {},
  returns: v.array(reminderView),
  handler: async (ctx) => {
    const user = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_user_done_at", (q) => q.eq("userId", user._id).eq("done", false))
      .take(MAX_UPCOMING);
    return rows.map((r) => ({ id: r._id, text: r.text, at: r.at }));
  },
});

/** Delete one of your reminders; a reminder that hasn't fired is cancelled. */
export const remove = mutation({
  args: { id: v.id("reminders") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const user = await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== user._id) fail("Reminder not found.");
    if (!row.done && row.jobId) await ctx.scheduler.cancel(row.jobId);
    await ctx.db.delete(id);
    return null;
  },
});

/** The reminder's time has come: mark it done and push it to its admin's devices. */
export const fire = internalMutation({
  args: { id: v.id("reminders") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.done) return null;
    await ctx.db.patch(id, { done: true, jobId: undefined });
    await ctx.scheduler.runAfter(0, internal.push.notifyAdmins, {
      title: "Reminder",
      body: row.text,
      url: studioUrl("/reminders"),
      tag: `reminder-${id}`,
      userId: row.userId,
    });
    return null;
  },
});
