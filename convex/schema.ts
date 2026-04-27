import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    name: v.string(),
    email: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    userborded: v.optional(v.boolean()),
    profilePicture: v.optional(v.string()),
    lastname: v.optional(v.string()),
    phone: v.optional(v.string()),
    location: v.optional(v.string()),
    preferredContactMethod: v.optional(v.string()),
    role: v.optional(v.string()), // user, admin, seller
    payementMethod: v.optional(v.string()),
    hasAcceptedBankTerms: v.optional(v.boolean()),
    volooMagicUnlocked: v.optional(v.boolean()),

    // 2. The Remote Control State: Remembers which UI they want to see right now
    activeAppMode: v.optional(v.union(v.literal("store"), v.literal("magic"))),
    hasSeenUnboxingPopup: v.optional(v.boolean()),
  }).index("byExternalId", ["externalId"]),

  organizations: defineTable({
    clerkId: v.string(),
    name: v.string(),
    slug: v.string(),
    logoUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_id", ["clerkId"]),
});
