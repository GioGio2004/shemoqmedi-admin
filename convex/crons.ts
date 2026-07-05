import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Run the cleanup task daily at midnight UTC
crons.daily(
  "remove-expired-sessions",
  { minuteUTC: 0, hourUTC: 0 },
  api.cleanup.removeExpiredSessions,
);

// Refresh Google Business Profile data (rating, review count, hours) for all
// venues that have a gbpPlaceId. Runs at 2:30 AM UTC (low-traffic window).
// Uses Places API (New) — see convex/venues.ts syncAllGoogleData for details.
crons.daily(
  "refresh-google-venue-data",
  { minuteUTC: 30, hourUTC: 2 },
  api.venues.syncAllGoogleData,
);

export default crons;
