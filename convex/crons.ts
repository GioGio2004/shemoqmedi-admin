import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Both targets are internal* functions: crons can call them, clients cannot.
// (As public functions they were an unauthenticated cascading delete and a
// billable Google Places sweep that anyone could trigger.)

// Run the cleanup task daily at midnight UTC
crons.daily(
  "remove-expired-sessions",
  { minuteUTC: 0, hourUTC: 0 },
  internal.cleanup.removeExpiredSessions,
);

// Refresh Google Business Profile data (rating, review count, hours) for all
// venues that have a gbpPlaceId. Runs at 2:30 AM UTC (low-traffic window).
// Uses Places API (New) — see convex/venues.ts syncAllGoogleData for details.
crons.daily(
  "refresh-google-venue-data",
  { minuteUTC: 30, hourUTC: 2 },
  internal.venues.syncAllGoogleData,
);

export default crons;
