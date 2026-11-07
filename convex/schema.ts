import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const listingStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

export default defineSchema({
  // Created and kept in sync by the Clerk webhook (http.ts → users.upsertFromClerk).
  users: defineTable({
    externalId: v.string(), // Clerk user id (identity.subject)
    name: v.string(),
    email: v.string(),
    profilePicture: v.optional(v.string()),
    // Platform role, managed in Convex (never overwritten by Clerk data).
    role: v.optional(v.union(v.literal("admin"), v.literal("super_admin"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("byExternalId", ["externalId"])
    .index("byEmail", ["email"]),

  // A website submitted by a user. Public only once an admin approves it.
  listings: defineTable({
    ownerId: v.id("users"),
    slug: v.string(), // /sites/<slug>, unique
    title: v.string(),
    tagline: v.string(),
    url: v.string(), // normalized live URL
    category: v.string(), // CATEGORIES slug (convex/lib/taxonomy.ts)
    technologies: v.array(v.string()),
    creditName: v.string(), // who built it (person or studio)
    creditUrl: v.optional(v.string()),
    coverId: v.id("_storage"), // desktop screenshot, 16:10
    mobileId: v.optional(v.id("_storage")), // optional mobile screenshot

    status: listingStatus,
    reviewNote: v.optional(v.string()), // reason shown to the owner on rejection
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()), // first approval time; drives ordering

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_url", ["url"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status", "createdAt"])
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_status_category_published", ["status", "category", "publishedAt"]),
});
