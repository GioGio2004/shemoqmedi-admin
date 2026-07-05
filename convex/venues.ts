import { v } from "convex/values";
import { mutation, query, action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";

// ─────────────────────────────────────────────────────────────────────────────
// VENUES — admin CRUD + Google Business Profile sync
//
// Admin mutations require authentication (Convex built-in auth via Clerk).
// The GBP sync action uses Google Places API (New) — NOT the legacy endpoint.
//
// Places API (New) endpoint:  https://places.googleapis.com/v1/places/{placeId}
// Auth pattern: X-Goog-Api-Key header (NOT ?key= query param)
//               X-Goog-FieldMask header is REQUIRED per the new API contract
// ─────────────────────────────────────────────────────────────────────────────

// ── Admin Queries ─────────────────────────────────────────────────────────────

/** listAll — admin view of all venues including drafts */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("venues").collect();
  },
});

/** getById — admin fetch single venue */
export const getById = query({
  args: { id: v.id("venues") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

/** getByOrgId — admin fetch single venue by organization */
export const getByOrgId = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    return ctx.db
      .query("venues")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
  },
});

// ── Admin Mutations ───────────────────────────────────────────────────────────

/**
 * upsertVenue — create or update a venue record.
 * If a venue with the same slug already exists, updates it in-place.
 * If not, inserts a new document.
 */
export const upsertVenue = mutation({
  args: {
    orgId:        v.string(),
    slug:         v.string(),
    name:         v.string(),
    category:     v.union(
      v.literal("cafe"),
      v.literal("restaurant"),
      v.literal("bar"),
      v.literal("hotel"),
      v.literal("other"),
    ),
    description:  v.string(),
    address:      v.string(),
    lat:          v.optional(v.number()),
    lng:          v.optional(v.number()),
    phone:        v.optional(v.string()),
    hours:        v.optional(v.array(v.object({ day: v.string(), hours: v.string() }))),
    coverImage:   v.optional(v.string()),
    galleryImages: v.optional(v.array(v.string())),
    tags:         v.optional(v.array(v.string())),
    gbpPlaceId:   v.optional(v.string()),
    isPublished:  v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("venues")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }

    return ctx.db.insert("venues", {
      ...args,
      isPublished: args.isPublished ?? false,
      createdAt:   now,
      updatedAt:   now,
    });
  },
});

/** setPublished — toggle a venue's publish state */
export const setPublished = mutation({
  args: {
    id:          v.id("venues"),
    isPublished: v.boolean(),
  },
  handler: async (ctx, { id, isPublished }) => {
    await ctx.db.patch(id, { isPublished, updatedAt: Date.now() });
  },
});

/** updateLocation — admin update precise lat/lng */
export const updateLocation = mutation({
  args: {
    orgId: v.string(),
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (ctx, { orgId, lat, lng }) => {
    const venue = await ctx.db
      .query("venues")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    if (venue) {
      await ctx.db.patch(venue._id, { lat, lng, updatedAt: Date.now() });
    }
  },
});

// ── Internal patch used by the GBP sync action ─────────────────────────────

export const patchGoogleData = internalMutation({
  args: {
    id:                      v.id("venues"),
    googleRating:            v.optional(v.number()),
    googleReviewCount:       v.optional(v.number()),
    hours:                   v.optional(v.array(v.object({ day: v.string(), hours: v.string() }))),
    googleDataLastFetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
  },
});

// ── Google Business Profile Sync (Places API New) ─────────────────────────────

/**
 * syncAllGoogleData — Convex Action scheduled daily by crons.ts.
 *
 * For every venue with a gbpPlaceId:
 *   1. Calls Google Places API (New): GET /v1/places/{placeId}
 *      Auth: X-Goog-Api-Key header + X-Goog-FieldMask header (REQUIRED)
 *   2. Patches googleRating, googleReviewCount, hours into the venue row
 *   3. Per-venue try/catch — one bad placeId never aborts the rest of the batch
 *
 * API Reference: https://developers.google.com/maps/documentation/places/web-service/place-details
 * New Places API endpoint: https://places.googleapis.com/v1/places/{placeId}
 */
export const syncAllGoogleData = action({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.GOOGLE_PLACE_API_KEY;
    if (!apiKey) {
      console.error("[GBP Sync] GOOGLE_PLACE_API_KEY not set — aborting sync");
      return { synced: 0, errors: 0 };
    }

    // Fetch all venues that have a GBP Place ID
    const venues: Array<{
      _id: string;
      gbpPlaceId?: string | null;
    }> = await ctx.runQuery(api.venues.listAll);

    const withPlaceId = venues.filter(
      (v): v is typeof v & { gbpPlaceId: string } =>
        typeof v.gbpPlaceId === "string" && v.gbpPlaceId.length > 0,
    );

    let synced = 0;
    let errors = 0;

    for (const venue of withPlaceId) {
      try {
        // ── Places API (New) — correct endpoint and auth pattern ──────────────
        // Legacy endpoint (maps.googleapis.com) uses ?key= query param.
        // New endpoint (places.googleapis.com) requires:
        //   - X-Goog-Api-Key header for auth
        //   - X-Goog-FieldMask header to declare which fields to return (REQUIRED)
        const fieldMask = [
          "rating",
          "userRatingCount",
          "currentOpeningHours",
          "regularOpeningHours",
        ].join(",");

        const response = await fetch(
          `https://places.googleapis.com/v1/places/${venue.gbpPlaceId}`,
          {
            method: "GET",
            headers: {
              "X-Goog-Api-Key":   apiKey,
              "X-Goog-FieldMask": fieldMask,
              "Content-Type":     "application/json",
            },
          },
        );

        if (!response.ok) {
          const text = await response.text();
          console.warn(
            `[GBP Sync] Place ${venue.gbpPlaceId} returned HTTP ${response.status}: ${text}`,
          );
          errors++;
          continue;
        }

        const data = await response.json();

        // ── Parse opening hours from either field the API returns ─────────────
        // The API may return currentOpeningHours or regularOpeningHours
        const openingHoursSource =
          data.currentOpeningHours ?? data.regularOpeningHours;

        const hours: Array<{ day: string; hours: string }> = [];
        if (openingHoursSource?.weekdayDescriptions) {
          // e.g. ["Monday: 9:00 AM – 6:00 PM", "Tuesday: 9:00 AM – 6:00 PM"]
          for (const desc of openingHoursSource.weekdayDescriptions as string[]) {
            const colonIdx = desc.indexOf(":");
            if (colonIdx === -1) continue;
            hours.push({
              day:   desc.slice(0, colonIdx).trim(),
              hours: desc.slice(colonIdx + 1).trim(),
            });
          }
        }

        await ctx.runMutation(internal.venues.patchGoogleData, {
          id:                      venue._id as any,
          googleRating:            typeof data.rating === "number" ? data.rating : undefined,
          googleReviewCount:       typeof data.userRatingCount === "number" ? data.userRatingCount : undefined,
          hours:                   hours.length > 0 ? hours : undefined,
          googleDataLastFetchedAt: Date.now(),
        });

        synced++;
        console.log(`[GBP Sync] ✅ ${venue.gbpPlaceId} — rating=${data.rating ?? "n/a"}`);
      } catch (err) {
        // Per-venue guard: one bad placeId never aborts the rest of the batch
        console.error(`[GBP Sync] ❌ Failed for ${venue.gbpPlaceId}:`, err);
        errors++;
      }
    }

    console.log(`[GBP Sync] Complete — synced=${synced} errors=${errors}`);
    return { synced, errors };
  },
});
