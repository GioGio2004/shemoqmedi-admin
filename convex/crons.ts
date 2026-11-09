import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Award calendar (convex/awards.ts): close ended weekly batches, announce the
// day's Site of the Day at the announce time, open and announce the monthly
// and yearly rounds. Every step is idempotent, so a frequent tick is safe.
crons.interval("awards tick", { minutes: 15 }, internal.awards.tick, {});

// Jurors' digest of new submissions in their interest categories.
crons.interval("jury digest", { minutes: 30 }, internal.digest.run, {});

export default crons;
