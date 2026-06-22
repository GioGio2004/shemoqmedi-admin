/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiChatThemes from "../aiChatThemes.js";
import type * as analytics from "../analytics.js";
import type * as authHelpers from "../authHelpers.js";
import type * as backfill from "../backfill.js";
import type * as categories from "../categories.js";
import type * as chat from "../chat.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_utils from "../lib/utils.js";
import type * as memberships from "../memberships.js";
import type * as menuItems from "../menuItems.js";
import type * as orders from "../orders.js";
import type * as organizations from "../organizations.js";
import type * as publicMenu from "../publicMenu.js";
import type * as tableSessions from "../tableSessions.js";
import type * as users from "../users.js";
import type * as volooAi from "../volooAi.js";
import type * as volootags from "../volootags.js";
import type * as volootagsAdmin from "../volootagsAdmin.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiChatThemes: typeof aiChatThemes;
  analytics: typeof analytics;
  authHelpers: typeof authHelpers;
  backfill: typeof backfill;
  categories: typeof categories;
  chat: typeof chat;
  cleanup: typeof cleanup;
  crons: typeof crons;
  http: typeof http;
  "lib/utils": typeof lib_utils;
  memberships: typeof memberships;
  menuItems: typeof menuItems;
  orders: typeof orders;
  organizations: typeof organizations;
  publicMenu: typeof publicMenu;
  tableSessions: typeof tableSessions;
  users: typeof users;
  volooAi: typeof volooAi;
  volootags: typeof volootags;
  volootagsAdmin: typeof volootagsAdmin;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
