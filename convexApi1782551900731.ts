import { type FunctionReference, anyApi } from "convex/server";
import { type GenericId as Id } from "convex/values";

export const api: PublicApiType = anyApi as unknown as PublicApiType;
export const internal: InternalApiType = anyApi as unknown as InternalApiType;

export type PublicApiType = {
  users: {
    getCurrentUser: FunctionReference<
      "query",
      "public",
      Record<string, never>,
      {
        _creationTime: number;
        _id: Id<"users">;
        activeAppMode?: "store" | "magic";
        createdAt: number;
        email: string;
        externalId: string;
        hasAcceptedBankTerms?: boolean;
        hasSeenUnboxingPopup?: boolean;
        lastname?: string;
        location?: string;
        name: string;
        payementMethod?: string;
        phone?: string;
        preferredContactMethod?: string;
        profilePicture?: string;
        role?: string;
        updatedAt: number;
        userborded?: boolean;
        volooMagicUnlocked?: boolean;
      } | null
    >;
    get: FunctionReference<"query", "public", { id: Id<"users"> }, any>;
    getAllUserDetails: FunctionReference<
      "query",
      "public",
      Record<string, never>,
      Array<{
        _id: Id<"users">;
        createdAt: number;
        email: string;
        externalId: string;
        lastname: string;
        location: string;
        name: string;
        payementMethod: string;
        phone: string;
        preferredContactMethod: string;
        profilePicture: string;
        role: string;
        updatedAt: number;
        userborded: boolean;
      }>
    >;
  };
  organizations: {
    getAllOrganizationsWithMembers: FunctionReference<
      "query",
      "public",
      Record<string, never>,
      any
    >;
    updateThemeSettings: FunctionReference<
      "mutation",
      "public",
      {
        orgId: string;
        themeSettings: {
          buttonRadius: string;
          fontFamily: string;
          primaryColor: string;
        };
      },
      any
    >;
    updateFeatures: FunctionReference<
      "mutation",
      "public",
      {
        features: {
          hasAiManager: boolean;
          hasCustomDomain: boolean;
          hasDigitalMenu: boolean;
          hasLiveOrdering: boolean;
          hasNfcHardware: boolean;
        };
        orgId: string;
      },
      any
    >;
    getOrgSettings: FunctionReference<
      "query",
      "public",
      { orgId: string },
      any
    >;
    updateStorefrontConfig: FunctionReference<
      "mutation",
      "public",
      {
        announcements?: Array<{
          id: string;
          isActive: boolean;
          message: string;
        }>;
        operatingHours?: Array<{ day: string; hours: string }>;
        orgId: string;
        socialLinks?: { email?: string; instagram?: string; whatsapp?: string };
        storefrontConfig?: {
          address: string;
          cityStateZip: string;
          coverImageUrl?: string;
          heroHeadline: string;
          heroImageUrls: Array<string>;
          heroSubheadline: string;
          primaryButtonText?: string;
          secondaryButtonText?: string;
        };
        themeSettings?: {
          backgroundColor?: string;
          buttonRadius: string;
          fontFamily: string;
          menuType?: "basic" | "dragable";
          primaryColor: string;
          textColor?: string;
        };
      },
      any
    >;
    getStorefrontConfig: FunctionReference<
      "query",
      "public",
      { orgId: string },
      any
    >;
  };
  memberships: {
    updateCustomRole: FunctionReference<
      "mutation",
      "public",
      { customRole: string; orgId: string; userId: string },
      any
    >;
    getMyRole: FunctionReference<"query", "public", { orgId?: string }, any>;
  };
  categories: {
    list: FunctionReference<"query", "public", { orgId: string }, any>;
    create: FunctionReference<
      "mutation",
      "public",
      { imageUrl?: string; name: Record<string, string>; orgId: string },
      any
    >;
    updateSort: FunctionReference<
      "mutation",
      "public",
      { orderedIds: Array<Id<"categories">>; orgId: string },
      any
    >;
    update: FunctionReference<
      "mutation",
      "public",
      {
        categoryId: Id<"categories">;
        imageUrl?: string;
        name: Record<string, string>;
        orgId: string;
      },
      any
    >;
    archive: FunctionReference<
      "mutation",
      "public",
      { categoryId: Id<"categories">; orgId: string },
      any
    >;
  };
  menuItems: {
    listByCategory: FunctionReference<
      "query",
      "public",
      { categoryId: Id<"categories">; orgId: string },
      any
    >;
    listByOrg: FunctionReference<"query", "public", { orgId: string }, any>;
    create: FunctionReference<
      "mutation",
      "public",
      {
        categoryId: Id<"categories">;
        description?: Record<string, string>;
        imageUrl?: string;
        name: Record<string, string>;
        orgId: string;
        price: number;
        tags?: Array<string>;
      },
      any
    >;
    update: FunctionReference<
      "mutation",
      "public",
      {
        categoryId?: Id<"categories">;
        description?: Record<string, string>;
        imageUrl?: string;
        isAvailable?: boolean;
        menuItemId: Id<"menuItems">;
        name?: Record<string, string>;
        orgId: string;
        price?: number;
        tags?: Array<string>;
      },
      any
    >;
    archive: FunctionReference<
      "mutation",
      "public",
      { menuItemId: Id<"menuItems">; orgId: string },
      any
    >;
    updateSort: FunctionReference<
      "mutation",
      "public",
      { orderedIds: Array<Id<"menuItems">>; orgId: string },
      any
    >;
    setAllAvailability: FunctionReference<
      "mutation",
      "public",
      { isAvailable: boolean; orgId: string },
      any
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { menuItemId: Id<"menuItems">; orgId: string },
      any
    >;
  };
  backfill: {
    syncMembership: FunctionReference<
      "mutation",
      "public",
      { clerkUserId: string; orgId: string; role: string },
      any
    >;
    setRole: FunctionReference<
      "mutation",
      "public",
      { clerkUserId: string; role: string },
      any
    >;
    listUsers: FunctionReference<"query", "public", Record<string, never>, any>;
  };
  publicMenu: {
    get: FunctionReference<"query", "public", { slug: string }, any>;
    listOrganizations: FunctionReference<
      "query",
      "public",
      Record<string, never>,
      any
    >;
  };
  chat: {
    getMessages: FunctionReference<
      "query",
      "public",
      { cafeId: string; sessionId: string },
      any
    >;
    sendMessage: FunctionReference<
      "mutation",
      "public",
      {
        cafeId: string;
        content: string;
        products?: Array<number>;
        role: "user" | "assistant";
        sessionId: string;
      },
      any
    >;
    submitRating: FunctionReference<
      "mutation",
      "public",
      { cafeId: string; rating: number; sessionId: string },
      any
    >;
  };
  orders: {
    placeOrder: FunctionReference<
      "mutation",
      "public",
      {
        cafeId: string;
        guestId: string;
        items: Array<{
          name?: string;
          price?: number;
          productId: number | string;
          quantity: number;
        }>;
        seatNumber: number;
        sessionId: Id<"tableSessions">;
        totalPrice?: number;
      },
      any
    >;
    getOrders: FunctionReference<"query", "public", { cafeId: string }, any>;
    updateOrderStatus: FunctionReference<
      "mutation",
      "public",
      {
        orderId: Id<"tableOrders">;
        status: "pending" | "completed" | "cancelled";
      },
      any
    >;
  };
  volootags: {
    logTapMoment: FunctionReference<
      "mutation",
      "public",
      { timezone?: string; uuid: string },
      any
    >;
    toggleAppMode: FunctionReference<
      "mutation",
      "public",
      { activeAppMode: "store" | "magic"; userId: string },
      any
    >;
    getActiveTag: FunctionReference<
      "query",
      "public",
      { userId?: string },
      any
    >;
    getUserMagicStatus: FunctionReference<
      "query",
      "public",
      { userId?: string },
      any
    >;
    markUnboxingSeen: FunctionReference<
      "mutation",
      "public",
      { userId: string },
      any
    >;
    getTagByUUID: FunctionReference<"query", "public", { uuid: string }, any>;
    clearActivationAlert: FunctionReference<
      "mutation",
      "public",
      { tagId: Id<"volootags"> },
      any
    >;
    getUserTags: FunctionReference<"query", "public", { userId?: string }, any>;
    getUserProfile: FunctionReference<
      "query",
      "public",
      { userId?: string },
      any
    >;
    getTagTapStats: FunctionReference<
      "query",
      "public",
      { userId?: string },
      any
    >;
    getLeaderboard: FunctionReference<
      "query",
      "public",
      Record<string, never>,
      any
    >;
    getGlobalStats: FunctionReference<
      "query",
      "public",
      Record<string, never>,
      any
    >;
    updateTagMode: FunctionReference<
      "mutation",
      "public",
      { activeMode: string; payload?: any; tagId: Id<"volootags"> },
      any
    >;
    updateTagAnimation: FunctionReference<
      "mutation",
      "public",
      {
        greetingText?: string;
        selectedAnimation?: string;
        showAnimation?: boolean;
        tagId: Id<"volootags">;
        textAnimationStyle?: string;
      },
      any
    >;
    claimTag: FunctionReference<"mutation", "public", { uuid: string }, any>;
    releaseTag: FunctionReference<
      "mutation",
      "public",
      { tagId: Id<"volootags"> },
      any
    >;
  };
  volootagsAdmin: {
    provisionPhysicalTag: FunctionReference<
      "mutation",
      "public",
      {
        orgId?: string;
        seatNumber?: number;
        tableName?: string;
        volooTagsUUID: string;
      },
      any
    >;
    updatePhysicalTag: FunctionReference<
      "mutation",
      "public",
      {
        isActive?: boolean;
        orgId?: string;
        seatNumber?: number;
        tableName?: string;
        tagId: Id<"physicalTags">;
      },
      any
    >;
    deletePhysicalTag: FunctionReference<
      "mutation",
      "public",
      { tagId: Id<"physicalTags"> },
      any
    >;
    getAllPhysicalTags: FunctionReference<
      "query",
      "public",
      { orgId?: string },
      any
    >;
    getPhysicalTagByUUID: FunctionReference<
      "query",
      "public",
      { uuid: string },
      any
    >;
    logPhysicalTagTap: FunctionReference<
      "mutation",
      "public",
      { uuid: string },
      any
    >;
    updateTagUUID: FunctionReference<
      "mutation",
      "public",
      { newUUID: string; tagId: Id<"physicalTags"> },
      any
    >;
    getOrgTagSettings: FunctionReference<
      "query",
      "public",
      { orgId: string },
      any
    >;
    getOrgTagSettingsPublic: FunctionReference<
      "query",
      "public",
      { orgId: string },
      any
    >;
    upsertOrgTagSettings: FunctionReference<
      "mutation",
      "public",
      {
        activeMode:
          | "digital_menu"
          | "call_waiter"
          | "payment_terminal"
          | "cafe_hub";
        hubMenuUrl?: string;
        hubTheme?: string;
        orgId: string;
        selectedAnimation: string;
        showAnimation: boolean;
        wifiPassword?: string;
        wifiSsid?: string;
      },
      any
    >;
    getPhysicalTagStats: FunctionReference<
      "query",
      "public",
      Record<string, never>,
      any
    >;
  };
  volooAi: {
    logChat: FunctionReference<
      "mutation",
      "public",
      {
        actionExecuted?: string;
        message: string;
        orgId: string;
        role: "manager" | "volooAI" | "system";
      },
      any
    >;
    logAction: FunctionReference<
      "mutation",
      "public",
      { actionType: string; details: string; orgId: string; targetId?: string },
      any
    >;
    toggleMenuItem: FunctionReference<
      "mutation",
      "public",
      { action: "hide" | "show"; orgId: string; targetName: string },
      any
    >;
    getMenuStatus: FunctionReference<
      "query",
      "public",
      { isAvailable?: boolean; orgId: string; searchTerm?: string },
      any
    >;
    updateItemDescription: FunctionReference<
      "mutation",
      "public",
      { newDescription: string; orgId: string; targetId: string },
      any
    >;
    updateStorefrontTheme: FunctionReference<
      "mutation",
      "public",
      {
        backgroundColor?: string;
        buttonRadius?: string;
        fontFamily?: string;
        orgId: string;
        primaryColor?: string;
        textColor?: string;
      },
      any
    >;
    getAdminChatHistory: FunctionReference<
      "query",
      "public",
      { limit?: number; orgId: string },
      any
    >;
    broadcastStorefrontAlert: FunctionReference<
      "mutation",
      "public",
      { alertMessage: string; orgId: string },
      any
    >;
  };
  aiChatThemes: {
    get: FunctionReference<"query", "public", { orgId?: string }, any>;
    getBySlug: FunctionReference<"query", "public", { slug: string }, any>;
    update: FunctionReference<
      "mutation",
      "public",
      {
        backgroundColor: string;
        backgroundTemplate?: string;
        botAvatarUrl?: string;
        botMessageBg: string;
        botMessageText: string;
        botName?: string;
        fontFamily: string;
        greetingMessage?: string;
        isActive: boolean;
        orgId: string;
        primaryColor: string;
        textColor: string;
        userMessageBg: string;
        userMessageText: string;
      },
      any
    >;
  };
  cleanup: {
    removeExpiredSessions: FunctionReference<"mutation", "public", any, any>;
  };
  analytics: {
    getOverviewStats: FunctionReference<
      "query",
      "public",
      { orgId: string },
      any
    >;
  };
  tableSessions: {
    joinSession: FunctionReference<
      "mutation",
      "public",
      { guestId: string; orgId: string; tagId: Id<"physicalTags"> },
      any
    >;
    freeTable: FunctionReference<
      "mutation",
      "public",
      { sessionId: Id<"tableSessions">; tagId: Id<"physicalTags"> },
      any
    >;
    getSession: FunctionReference<
      "query",
      "public",
      { sessionId?: Id<"tableSessions"> },
      any
    >;
    getSessionOrders: FunctionReference<
      "query",
      "public",
      { sessionId?: Id<"tableSessions"> },
      any
    >;
    broadcastSuggestion: FunctionReference<
      "mutation",
      "public",
      { itemName: string; sessionId: Id<"tableSessions">; suggestedBy: string },
      any
    >;
    syncCart: FunctionReference<
      "mutation",
      "public",
      {
        guestId: string;
        items: Array<{
          id: string;
          image?: string;
          name: string;
          price: number;
          quantity: number;
        }>;
        sessionId: Id<"tableSessions">;
      },
      any
    >;
  };
  admin: {
    bulkImportMenu: FunctionReference<
      "mutation",
      "public",
      {
        orgId: string;
        payload: {
          categories: Array<{
            items: Array<{
              accentColor?: string;
              description?: Record<string, string>;
              imageUrl?: string;
              name: Record<string, string>;
              price: number;
              sortOrder: number;
              tags?: Array<string>;
            }>;
            name: Record<string, string>;
            sortOrder: number;
          }>;
        };
      },
      any
    >;
  };
  aiTrainingLogs: {
    ingestTurn: FunctionReference<
      "mutation",
      "public",
      {
        cafeId: string;
        contents: Array<{
          parts: Array<{ text: string }>;
          role: "user" | "model";
        }>;
        nootype?: string;
        positiveSignal: boolean;
        rawModelJson: string;
        sessionId: string;
        systemInstruction: string;
      },
      any
    >;
    updateSignal: FunctionReference<
      "mutation",
      "public",
      {
        cafeId: string;
        nootype?: string;
        positiveSignal: boolean;
        sessionId: string;
      },
      any
    >;
    listForExport: FunctionReference<
      "query",
      "public",
      {
        cafeId: string;
        limit?: number;
        nootype?: string;
        onlyPositive?: boolean;
      },
      any
    >;
    markExported: FunctionReference<
      "mutation",
      "public",
      { ids: Array<Id<"ai_training_logs">> },
      any
    >;
    getStats: FunctionReference<"query", "public", { cafeId: string }, any>;
  };
};
export type InternalApiType = {};
