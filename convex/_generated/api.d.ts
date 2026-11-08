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
import type * as authHelpers from "../authHelpers.js";
import type * as claimLinks from "../claimLinks.js";
import type * as claims from "../claims.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as importer from "../importer.js";
import type * as jury from "../jury.js";
import type * as lib_imagekitServer from "../lib/imagekitServer.js";
import type * as lib_listingHelpers from "../lib/listingHelpers.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_taxonomy from "../lib/taxonomy.js";
import type * as lib_utils from "../lib/utils.js";
import type * as listings from "../listings.js";
import type * as media from "../media.js";
import type * as seed from "../seed.js";
import type * as seo from "../seo.js";
import type * as users from "../users.js";
import type * as votes from "../votes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  authHelpers: typeof authHelpers;
  claimLinks: typeof claimLinks;
  claims: typeof claims;
  creators: typeof creators;
  crons: typeof crons;
  http: typeof http;
  importer: typeof importer;
  jury: typeof jury;
  "lib/imagekitServer": typeof lib_imagekitServer;
  "lib/listingHelpers": typeof lib_listingHelpers;
  "lib/media": typeof lib_media;
  "lib/r2": typeof lib_r2;
  "lib/scoring": typeof lib_scoring;
  "lib/taxonomy": typeof lib_taxonomy;
  "lib/utils": typeof lib_utils;
  listings: typeof listings;
  media: typeof media;
  seed: typeof seed;
  seo: typeof seo;
  users: typeof users;
  votes: typeof votes;
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
