import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Award calendar (convex/awards.ts): close ended weekly batches, announce the
// day's Site of the Day at the announce time, open and announce the monthly
// and yearly rounds. Every step is idempotent, so a frequent tick is safe.
crons.interval("awards tick", { minutes: 15 }, internal.awards.tick, {});

// Jurors' digest of new submissions in their interest categories.
crons.interval("jury digest", { minutes: 30 }, internal.digest.run, {});

// The social desk (social.ts). Times are UTC; Tbilisi is UTC+4.
// Sites that just went public get a "new listing" post (idempotent).
crons.interval("social: new listings", { minutes: 30 }, internal.social.queueNewListings, {});
// Monday 10:00 Tbilisi: call for submissions. Thursday, every other week: call for jurors.
crons.weekly("social: call for submissions", { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 }, internal.social.queueCall, {
  kind: "call_submissions",
});
crons.weekly("social: call for jurors", { dayOfWeek: "thursday", hourUTC: 6, minuteUTC: 0 }, internal.social.queueCall, {
  kind: "call_jury",
  everyOtherWeek: true,
});
// Sunday 18:00 Tbilisi: the week's roundup.
crons.weekly("social: weekly roundup", { dayOfWeek: "sunday", hourUTC: 14, minuteUTC: 0 }, internal.social.queueRoundup, {});
// Every morning 09:00 Tbilisi: "N posts waiting" to the admins.
crons.daily("social: waiting nudge", { hourUTC: 5, minuteUTC: 0 }, internal.social.waitingPing, {});
// Every morning 08:30 Tbilisi: pick up new env tokens, refresh the Threads
// token when it is due, email the admins before the LinkedIn token expires.
crons.daily("social: channels", { hourUTC: 4, minuteUTC: 30 }, internal.channels.daily, {});

export default crons;
