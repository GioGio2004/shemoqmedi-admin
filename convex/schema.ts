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
    storefrontConfig: v.optional(
      v.object({
        heroHeadline: v.union(v.string(), translatedText),
        heroSubheadline: v.union(v.string(), translatedText),
        primaryButtonText: v.optional(v.union(v.string(), translatedText)),
        secondaryButtonText: v.optional(v.union(v.string(), translatedText)),
        coverImageUrl: v.optional(v.string()), // For the landing page card / primary background
        heroImageUrls: v.array(v.string()), // For the 3 floating images
        address: v.string(),
        cityStateZip: v.string(),
      }),
    ),

    // NEW: Operating Hours (For the InfoSection)
    operatingHours: v.optional(
      v.array(
        v.object({
          day: v.string(), // e.g., "Mon - Fri"
          hours: v.string(), // e.g., "07:00 - 19:00"
        }),
      ),
    ),

    // NEW: Social Links (For the ContactDropdown)
    socialLinks: v.optional(
      v.object({
        whatsapp: v.optional(v.string()),
        instagram: v.optional(v.string()),
        email: v.optional(v.string()),
      }),
    ),

    // The Liquid UI
    themeSettings: v.optional(
      v.object({
        primaryColor: v.string(),
        backgroundColor: v.optional(v.string()),
        textColor: v.optional(v.string()),
        fontFamily: v.string(),
        buttonRadius: v.string(),
        menuType: v.optional(v.union(v.literal("basic"), v.literal("dragable"))),
      }),
    ),
    // Custom branding for the end-user's glassy mobile PWA
    themeConfig: v.optional(
      v.object({
        primaryColor: v.string(),
        isDarkModeDefault: v.boolean(),
      }),
    ),

    // Future-Proofing: Billing & Subscriptions
    subscriptionPlan: v.optional(
      v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
    ),

    flittRectoken: v.optional(v.string()), // The saved card token. Crucial for dynamic billing.
    flittMaskedCard: v.optional(v.string()), // e.g., "4111********1111" (for your UI)
    flittCardType: v.optional(v.string()), // e.g., "visa", "mastercard"

    features: v.optional(
      v.object({
        hasNfcHardware: v.boolean(),
        hasDigitalMenu: v.boolean(),
        hasCustomDomain: v.boolean(),
        hasAiManager: v.boolean(),
        hasLiveOrdering: v.boolean(),
      }),
    ),

    // VolooAI Megaphone — real-time alert broadcast to all customers
    announcements: v.optional(
      v.array(
        v.object({
          id: v.string(),
          message: v.string(),
          isActive: v.boolean(),
        })
      )
    ),
    
    // Legacy field - keep for backwards compatibility with existing records
    storefrontAlert: v.optional(v.string()),

    // The Liquid UI
    isActive: v.optional(v.boolean()), // Always set to true on insert; optional to handle documents created before this field was added
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_slug", ["slug"]),

  // The Bridge: Maps Users to their Workspaces (Crucial for RBAC)
  memberships: defineTable({
    userId: v.id("users"),
    orgId: v.string(), // The Clerk Org ID
    role: v.string(), // "org:admin", "org:manager", "org:member"
    customRole: v.optional(v.string()), // Convex-native hospitality role (e.g., "owner", "barista")
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
      v.literal("cafe_hub"),
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
    seatNumber: v.optional(v.number()), // Exact integer seat number for AI auto-fill
    isActive: v.boolean(), // Hardware lockout switch

    // Analytics & Realtime Activation
    tapCount: v.number(),
    pendingActivationAlert: v.optional(v.boolean()), // Triggers your AirPods popup

    // NEW: Multiplayer Table Session Lock
    currentSessionId: v.optional(v.id("tableSessions")),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_uuid", ["volooTagsUUID"])
    .index("by_org", ["orgId"])
    .index("by_org_and_table", ["orgId", "tableName"])
    .index("by_tapCount", ["tapCount"]),

  // ==========================================
  // 3. THE CATALOG (Categories & Items)
  // ==========================================
  categories: defineTable({
    orgId: v.string(),
    name: translatedText,
    imageUrl: v.optional(v.string()),
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
    price: v.number(),
    imageUrl: v.optional(v.string()),

    isAvailable: v.boolean(),
    sortOrder: v.number(),

    // Maps perfectly to his `benefits: ["Smooth", "Strong"]`
    tags: v.optional(v.array(v.string())),

    // NEW: Maps perfectly to his `color: "bg-amber-700"`
    accentColor: v.optional(v.string()),
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
      v.literal("cancelled"),
    ),

    // Immutable snapshot of the items at the time of order
    items: v.array(
      v.object({
        menuItemId: v.id("menuItems"),
        quantity: v.number(),
        basePrice: v.number(),
        selectedModifiers: v.array(
          v.object({
            optionId: v.id("modifierOptions"),
            priceDelta: v.number(),
          }),
        ),
        specialInstructions: v.optional(v.string()),
      }),
    ),

    subtotal: v.number(),
    taxAmount: v.number(),
    totalAmount: v.number(),

    paymentStatus: v.union(
      v.literal("unpaid"),
      v.literal("paid_online"),
      v.literal("paid_cash"),
    ),

    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"]),

  subscriptions: defineTable({
    orgId: v.string(),

    // Dynamic Pricing Totals
    baseAmount: v.number(), // The base price in Tetri
    addOnAmount: v.number(), // The total cost of active add-ons in Tetri
    currency: v.string(), // "GEL"

    status: v.union(
      v.literal("trialing"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled"),
    ),

    // Flitt specific tracking
    lastFlittOrderId: v.optional(v.string()), // Tracks the specific ID of the last successful monthly charge

    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_status", ["status"]),

  // ==========================================
  // 7. AI CHAT (VolooAI Widget)
  // ==========================================
  
  aiChatThemes: defineTable({
    orgId: v.string(), // Clerk Org ID
    botName: v.optional(v.string()), // e.g. "Shemoqmedi Assistant"
    botAvatarUrl: v.optional(v.string()), // URL for bot avatar
    primaryColor: v.string(), // Main accent
    backgroundColor: v.string(), // Chat container background
    textColor: v.string(), // General text color
    userMessageBg: v.string(), // User message bubble color
    userMessageText: v.string(), // User message text color
    botMessageBg: v.string(), // Bot message bubble color
    botMessageText: v.string(), // Bot message text color
    fontFamily: v.string(),
    backgroundTemplate: v.optional(v.string()), // Identifier for specific animation/template (e.g. template_1)
    greetingMessage: v.optional(v.string()), // Welcome message
    isActive: v.boolean(),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  // These tables power the per-cafe AI assistant that lives on every
  // customer-facing digital menu page. Sessions are anonymous (UUID from
  // localStorage) and scoped to a cafeId (the org's slug) so two different
  // cafes never share conversation history.

  /**
   * chatSessions — one document per anonymous visitor session.
   * Created on the visitor's first message. Expires after 7 days.
   * cafeId = the org's URL slug (e.g. "karabak").
   */
  chatSessions: defineTable({
    sessionId: v.string(), // crypto.randomUUID() — generated client-side
    cafeId: v.string(), // org slug — tenant isolation key
    createdAt: v.number(), // epoch ms
    expiresAt: v.number(), // createdAt + 7 days
  })
    .index("bySessionId", ["sessionId"])
    .index("byCafeId", ["cafeId"]),

  /**
   * chatMessages — one document per chat turn (user or assistant).
   * `products` holds the integer IDs returned by Gemini so the frontend
   * can render recommendation cards alongside the AI's reply.
   */
  chatMessages: defineTable({
    sessionId: v.string(),
    cafeId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    products: v.optional(v.array(v.number())), // product IDs from Gemini
    timestamp: v.number(),
  }).index("bySession", ["sessionId", "cafeId"]),

  /**
   * chatRatings — one star-rating per session per cafe.
   * Shown after 4+ messages to capture UX satisfaction.
   */
  chatRatings: defineTable({
    sessionId: v.string(),
    cafeId: v.string(),
    rating: v.number(), // 1-5
    timestamp: v.number(),
  }).index("byCafeId", ["cafeId"]),

  // ==========================================
  // 8. ORDERS (Basket)
  // ==========================================
  
  tableSessions: defineTable({
    orgId: v.string(),
    tagId: v.id("physicalTags"),
    status: v.union(v.literal("active"), v.literal("closed")),
    activeGuestIds: v.array(v.string()),
    cartItems: v.optional(v.array(v.any())),
    latestSuggestion: v.optional(
      v.object({
        itemName: v.string(),
        suggestedBy: v.string(),
        timestamp: v.number(),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_tag_and_status", ["tagId", "status"]),

  tableOrders: defineTable({
    cafeId: v.string(), // org slug
    seatNumber: v.number(),
    sessionId: v.optional(v.id("tableSessions")),
    items: v.array(
      v.object({
        productId: v.union(v.number(), v.string()), // djb2 hash ID or convex string ID from the frontend
        name: v.string(),
        price: v.number(),
        quantity: v.number(),
        guestId: v.optional(v.string()), // UUID of the guest who added this item
      }),
    ),
    totalPrice: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
  })
    .index("by_cafe", ["cafeId"])
    .index("by_status", ["status"]),

  volootags: defineTable({
    userId: v.optional(v.string()),
    volooTagsUUID: v.string(),
    isActive: v.boolean(),
    characterId: v.optional(v.string()),
    showAnimation: v.optional(v.boolean()),
    selectedAnimation: v.optional(v.string()),
    greetingText: v.optional(v.string()),
    textAnimationStyle: v.optional(v.string()),

    activeMode: v.union(v.literal("cafe_hub")),

    redirectUrl: v.optional(v.string()),
    wifiSsid: v.optional(v.string()),
    wifiPassword: v.optional(v.string()),
    lostMessage: v.optional(v.string()),
    lostContactNumber: v.optional(v.string()),

    vcardName: v.optional(v.string()),
    vcardPhone: v.optional(v.string()),
    vcardEmail: v.optional(v.string()),
    vcardCompany: v.optional(v.string()),
    vcardTitle: v.optional(v.string()),
    vcardNote: v.optional(v.string()),

    // --- CAFE HUB PAYLOAD ---
    // Used when activeMode === "cafe_hub".
    // All fields are optional so existing tags need no migration.
    hubTheme: v.optional(
      v.union(
        v.literal("dark"), // pitch-black bg, light gray pill buttons
        v.literal("light"), // white bg, dark gray pill buttons
        v.literal("orange"), // zinc-950 bg, dark orange accent buttons
      ),
    ),
    hubBusinessName: v.optional(v.string()), // e.g. "Fabrika Coffee"
    hubMenuUrl: v.optional(v.string()),
    hubInstagramUrl: v.optional(v.string()),
    hubTiktokUrl: v.optional(v.string()),
    hubFacebookUrl: v.optional(v.string()),
    // Full-screen background image URL (preset or user-uploaded).
    // If set, renders behind the glassmorphic container on the tap page.
    hubBackgroundImageUrl: v.optional(v.string()),

    // linkedOrderId and linkedProductId removed — those were voloostore fields.
    // In shemoqmedi, NFC tags are linked to physicalTags (cafe table hardware), not orders.

    tapCount: v.optional(v.number()),

    // ✅ NEW: Set to true on the very first tap so the owner's
    // Magic dashboard can detect it in realtime and show the
    // AirPods-style activation popup. Cleared immediately after
    // the owner dismisses it.
    pendingActivationAlert: v.optional(v.boolean()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_uuid", ["volooTagsUUID"])
    .index("by_userId", ["userId"])
    .index("by_tapCount", ["tapCount"]),
  // ==========================================
  // 9. VOLOO AI ADMIN (The Brain)
  // ==========================================
  adminChats: defineTable({
    orgId: v.string(), // Keeps VolooAI isolated to the specific cafe
    role: v.union(
      v.literal("manager"),
      v.literal("volooAI"),
      v.literal("system"),
    ),
    message: v.string(),
    actionExecuted: v.optional(v.string()), // Tracks if this message triggered a DB mutation
    timestamp: v.number(),
  }).index("by_org", ["orgId"]),

  aiActionLogs: defineTable({
    orgId: v.string(),
    actionType: v.string(), // e.g., "UI_NAVIGATION", "MENU_MUTATION"
    targetId: v.optional(v.string()), // ID of the item that was changed
    details: v.string(), // e.g., "Hid Beef Skewers due to manager voice command"
    timestamp: v.number(),
  }).index("by_org", ["orgId"]),

  // ==========================================
  // 10. ADVANCED ANALYTICS (The Eyes)
  // ==========================================
  analyticsEvents: defineTable({
    orgId: v.string(),
    sessionId: v.string(), // Ties to the anonymous customer cookie
    eventType: v.string(), // "category_view", "filter_applied", "item_click"
    targetName: v.optional(v.string()), // e.g., "Vegan Filter" or "Latte"
    timeSpent: v.optional(v.number()), // How long did they look at it?
    timestamp: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_session", ["sessionId"]),
});
