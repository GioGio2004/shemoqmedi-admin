import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Starter schema. Users are created and kept in sync by the Clerk webhook
// (see http.ts → users.upsertFromClerk). Add new tables here as the product
// grows.
export default defineSchema({
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
});
