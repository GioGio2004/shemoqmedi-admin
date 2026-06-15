import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Run the cleanup task daily at midnight UTC
crons.daily(
  "remove-expired-sessions",
  { minuteUTC: 0, hourUTC: 0 },
  api.cleanup.removeExpiredSessions
);

export default crons;
