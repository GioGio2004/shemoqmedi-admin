import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// 🤖 AI-Ready Translation Object
// Accepts any language code the AI generates (e.g., { "en": "Coffee", "ka": "ყავა", "fr": "Café" })
const translatedText = v.record(v.string(), v.string());

export default defineSchema({
  // ==========================================
  // 1. IDENTITY & WORKSPACES
  // ==========================================
  users: defineTable({
    externalId: v.string(), // Clerk User ID
    name: v.string(),
    email: v.string(),
    profilePicture: v.optional(v.string()),
    lastname: v.optional(v.string()),
    phone: v.optional(v.string()),
    location: v.optional(v.string()),
    preferredContactMethod: v.optional(v.string()),
    role: v.optional(v.string()), // super_admin, etc.
    payementMethod: v.optional(v.string()),
    hasAcceptedBankTerms: v.optional(v.boolean()),
    userborded: v.optional(v.boolean()),

    // Voloo Hardware States
    volooMagicUnlocked: v.optional(v.boolean()),
    activeAppMode: v.optional(v.union(v.literal("store"), v.literal("magic"))),
    hasSeenUnboxingPopup: v.optional(v.boolean()),

    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("byExternalId", ["externalId"]),

  organizations: defineTable({
    clerkId: v.string(),
    name: v.string(),
    slug: v.string(),
    logoUrl: v.optional(v.string()),

    // Core Business Settings
    currency: v.optional(v.string()), // "GEL", "USD"
    taxRate: v.optional(v.number()), // e.g., 18 for 18% VAT
    timezone: v.optional(v.string()), // "Asia/Tbilisi"

    // Custom branding for the end-user's glassy mobile PWA
    themeConfig: v.optional(v.object({
      primaryColor: v.string(),
      isDarkModeDefault: v.boolean(),
    })),

    // Future-Proofing: Billing & Subscriptions
    subscriptionPlan: v.optional(v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise"))),
    stripeCustomerId: v.optional(v.string()),
    billingCycleEnd: v.optional(v.number()),

    isActive: v.optional(v.boolean()), // Always set to true on insert; optional to handle documents created before this field was added
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_id", ["clerkId"]),

  // The Bridge: Maps Users to their Workspaces (Crucial for RBAC)
  memberships: defineTable({
    userId: v.id("users"),
    orgId: v.string(), // The Clerk Org ID
    role: v.string(), // "org:admin", "org:manager", "org:member"
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .index("by_user_and_org", ["userId", "orgId"]),

  // ==========================================
  // 2. FLEET MANAGEMENT (Voloo Hardware)
  // ==========================================

  // THE BRAIN: Global Tag Configuration (1 per Cafe)
  orgTagSettings: defineTable({
    orgId: v.string(),

    // The Global Behavior (All tags in the cafe do this)
    activeMode: v.union(
      v.literal("digital_menu"),
      v.literal("call_waiter"),
      v.literal("payment_terminal"),
      v.literal("cafe_hub")
    ),

    // Global Animation
    showAnimation: v.boolean(),
    selectedAnimation: v.string(), // e.g. "Coffee-love.lottie"

    // Global Payload
    hubTheme: v.optional(v.string()),
    hubMenuUrl: v.optional(v.string()),
    wifiSsid: v.optional(v.string()),
    wifiPassword: v.optional(v.string()),

    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  // THE TERMINALS: The Physical Hardware (20-50 per Cafe)
  physicalTags: defineTable({
    orgId: v.optional(v.string()), // Null until tapped and claimed by an Org Admin
    volooTagsUUID: v.string(), // The hardware ID burned into the NFC

    // Local Identity
    tableName: v.optional(v.string()), // e.g., "Table 12", "Patio-A"
    isActive: v.boolean(), // Hardware lockout switch

    // Analytics & Realtime Activation
    tapCount: v.number(),
    pendingActivationAlert: v.optional(v.boolean()), // Triggers your AirPods popup

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_uuid", ["volooTagsUUID"])
    .index("by_org", ["orgId"])
    .index("by_org_and_table", ["orgId", "tableName"]),

  // ==========================================
  // 3. THE CATALOG (Categories & Items)
  // ==========================================
  categories: defineTable({
    orgId: v.string(),
    name: translatedText,
    sortOrder: v.number(),
    isActive: v.boolean(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_sort", ["orgId", "sortOrder"]),

  menuItems: defineTable({
    orgId: v.string(),
    categoryId: v.id("categories"),
    name: translatedText,
    description: v.optional(translatedText),
    price: v.number(), // Always store in Tetri/Cents (e.g., 550 = 5.50 GEL)
    imageUrl: v.optional(v.string()),

    isAvailable: v.boolean(),
    sortOrder: v.number(),
    tags: v.optional(v.array(v.string())), // e.g., "vegan", "spicy"
  })
    .index("by_org", ["orgId"])
    .index("by_category", ["categoryId"]),

  // ==========================================
  // 4. THE MODIFIER ENGINE (Complex Orders)
  // ==========================================
  modifierGroups: defineTable({
    orgId: v.string(),
    name: translatedText, // e.g., "Milk Options", "Size"
    isRequired: v.boolean(),
    minSelections: v.number(),
    maxSelections: v.number(),
  }).index("by_org", ["orgId"]),

  modifierOptions: defineTable({
    groupId: v.id("modifierGroups"),
    name: translatedText, // e.g., "Oat Milk", "Large"
    priceDelta: v.number(), // Additional cost in Tetri/Cents
    isAvailable: v.boolean(),
  }).index("by_group", ["groupId"]),

  itemModifierGroups: defineTable({
    menuItemId: v.id("menuItems"),
    modifierGroupId: v.id("modifierGroups"),
  })
    .index("by_item", ["menuItemId"])
    .index("by_group", ["modifierGroupId"]),

  // ==========================================
  // 5. THE ORDER PIPELINE
  // ==========================================
  orders: defineTable({
    orgId: v.string(),
    tagId: v.id("physicalTags"), // Links exactly to the table that tapped
    customerSessionId: v.optional(v.string()), // Anonymous browser fingerprint

    status: v.union(
      v.literal("pending"),
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("completed"),
      v.literal("cancelled")
    ),

    // Immutable snapshot of the items at the time of order
    items: v.array(v.object({
      menuItemId: v.id("menuItems"),
      quantity: v.number(),
      basePrice: v.number(),
      selectedModifiers: v.array(v.object({
        optionId: v.id("modifierOptions"),
        priceDelta: v.number(),
      })),
      specialInstructions: v.optional(v.string()),
    })),

    subtotal: v.number(),
    taxAmount: v.number(),
    totalAmount: v.number(),

    paymentStatus: v.union(
      v.literal("unpaid"),
      v.literal("paid_online"),
      v.literal("paid_cash")
    ),

    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"]),


  subscriptions: defineTable({
    orgId: v.string(), // Links to the Clerk Organization
    planId: v.string(), // e.g., "pro_monthly", "enterprise_yearly"

    // The lifecycle of the SaaS charge
    status: v.union(
      v.literal("trialing"),
      v.literal("active"),
      v.literal("past_due"), // If a Flitt card charge fails
      v.literal("canceled")
    ),

    // Payment Provider (Flitt) Identifiers
    providerSubscriptionId: v.optional(v.string()), // Flitt's recurring payment token
    providerCustomerId: v.optional(v.string()), // Flitt's saved customer/card ID

    // Billing Cycle

    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(), // If they cancel, keep active until the month ends

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_status", ["status"]),


});