import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Close 7-day voting windows that have ended and assign awards.
crons.interval("close expired voting", { minutes: 15 }, internal.listings.closeExpiredVoting, {});

// Publish each day's Site of the Day just after 00:00 UTC (and any day missed).
crons.interval("publish site of the day", { minutes: 15 }, internal.sotd.publishDue, {});

export default crons;
