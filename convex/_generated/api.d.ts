/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as aiChatThemes from "../aiChatThemes.js";
import type * as aiTrainingLogs from "../aiTrainingLogs.js";
import type * as analytics from "../analytics.js";
import type * as anonymousGuests from "../anonymousGuests.js";
import type * as authHelpers from "../authHelpers.js";
import type * as backfill from "../backfill.js";
import type * as backfillVenues from "../backfillVenues.js";
import type * as bagOrders from "../bagOrders.js";
import type * as bagsDashboard from "../bagsDashboard.js";
import type * as categories from "../categories.js";
import type * as chat from "../chat.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as devSeed from "../devSeed.js";
import type * as flitt from "../flitt.js";
import type * as http from "../http.js";
import type * as lib_utils from "../lib/utils.js";
import type * as memberships from "../memberships.js";
import type * as menuItems from "../menuItems.js";
import type * as onboarding from "../onboarding.js";
import type * as orders from "../orders.js";
import type * as organizations from "../organizations.js";
import type * as publicMenu from "../publicMenu.js";
import type * as publicVenues from "../publicVenues.js";
import type * as studio from "../studio.js";
import type * as studioConfig from "../studioConfig.js";
import type * as surpriseBags from "../surpriseBags.js";
import type * as tableSessions from "../tableSessions.js";
import type * as users from "../users.js";
import type * as venueDirectory from "../venueDirectory.js";
import type * as venues from "../venues.js";
import type * as volooAi from "../volooAi.js";
import type * as volootags from "../volootags.js";
import type * as volootagsAdmin from "../volootagsAdmin.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  aiChatThemes: typeof aiChatThemes;
  aiTrainingLogs: typeof aiTrainingLogs;
  analytics: typeof analytics;
  anonymousGuests: typeof anonymousGuests;
  authHelpers: typeof authHelpers;
  backfill: typeof backfill;
  backfillVenues: typeof backfillVenues;
  bagOrders: typeof bagOrders;
  bagsDashboard: typeof bagsDashboard;
  categories: typeof categories;
  chat: typeof chat;
  cleanup: typeof cleanup;
  crons: typeof crons;
  devSeed: typeof devSeed;
  flitt: typeof flitt;
  http: typeof http;
  "lib/utils": typeof lib_utils;
  memberships: typeof memberships;
  menuItems: typeof menuItems;
  onboarding: typeof onboarding;
  orders: typeof orders;
  organizations: typeof organizations;
  publicMenu: typeof publicMenu;
  publicVenues: typeof publicVenues;
  studio: typeof studio;
  studioConfig: typeof studioConfig;
  surpriseBags: typeof surpriseBags;
  tableSessions: typeof tableSessions;
  users: typeof users;
  venueDirectory: typeof venueDirectory;
  venues: typeof venues;
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
