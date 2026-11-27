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
import type * as audits from "../audits.js";
import type * as authHelpers from "../authHelpers.js";
import type * as awards from "../awards.js";
import type * as channels from "../channels.js";
import type * as claimLinks from "../claimLinks.js";
import type * as claims from "../claims.js";
import type * as conflicts from "../conflicts.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as digest from "../digest.js";
import type * as editorial from "../editorial.js";
import type * as emails from "../emails.js";
import type * as graphics from "../graphics.js";
import type * as guides from "../guides.js";
import type * as http from "../http.js";
import type * as importer from "../importer.js";
import type * as jury from "../jury.js";
import type * as lib_accountDeletion from "../lib/accountDeletion.js";
import type * as lib_awards from "../lib/awards.js";
import type * as lib_claimLinkRows from "../lib/claimLinkRows.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_conflicts from "../lib/conflicts.js";
import type * as lib_contacts from "../lib/contacts.js";
import type * as lib_design from "../lib/design.js";
import type * as lib_domains from "../lib/domains.js";
import type * as lib_editorial from "../lib/editorial.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_georgian from "../lib/georgian.js";
import type * as lib_guideStarters from "../lib/guideStarters.js";
import type * as lib_imagekitServer from "../lib/imagekitServer.js";
import type * as lib_imagekitSign from "../lib/imagekitSign.js";
import type * as lib_juryProfile from "../lib/juryProfile.js";
import type * as lib_listingHelpers from "../lib/listingHelpers.js";
import type * as lib_mcpAudit from "../lib/mcpAudit.js";
import type * as lib_mcpAuth from "../lib/mcpAuth.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_mediaEntry from "../lib/mediaEntry.js";
import type * as lib_publicRules from "../lib/publicRules.js";
import type * as lib_push from "../lib/push.js";
import type * as lib_quickSubmissions from "../lib/quickSubmissions.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_reel from "../lib/reel.js";
import type * as lib_resendApi from "../lib/resendApi.js";
import type * as lib_revisions from "../lib/revisions.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_socialApi from "../lib/socialApi.js";
import type * as lib_taxonomy from "../lib/taxonomy.js";
import type * as lib_teamAuth from "../lib/teamAuth.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_utils from "../lib/utils.js";
import type * as lib_voiceover from "../lib/voiceover.js";
import type * as listings from "../listings.js";
import type * as mcp from "../mcp.js";
import type * as media from "../media.js";
import type * as migrations from "../migrations.js";
import type * as notify from "../notify.js";
import type * as pendingActions from "../pendingActions.js";
import type * as publish from "../publish.js";
import type * as push from "../push.js";
import type * as pushSend from "../pushSend.js";
import type * as quickSubmit from "../quickSubmit.js";
import type * as rateLimits from "../rateLimits.js";
import type * as reels from "../reels.js";
import type * as reminders from "../reminders.js";
import type * as resendLog from "../resendLog.js";
import type * as rounds from "../rounds.js";
import type * as seed from "../seed.js";
import type * as seo from "../seo.js";
import type * as social from "../social.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";
import type * as voiceover from "../voiceover.js";
import type * as votes from "../votes.js";
import type * as votingEmails from "../votingEmails.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  audits: typeof audits;
  authHelpers: typeof authHelpers;
  awards: typeof awards;
  channels: typeof channels;
  claimLinks: typeof claimLinks;
  claims: typeof claims;
  conflicts: typeof conflicts;
  creators: typeof creators;
  crons: typeof crons;
  digest: typeof digest;
  editorial: typeof editorial;
  emails: typeof emails;
  graphics: typeof graphics;
  guides: typeof guides;
  http: typeof http;
  importer: typeof importer;
  jury: typeof jury;
  "lib/accountDeletion": typeof lib_accountDeletion;
  "lib/awards": typeof lib_awards;
  "lib/claimLinkRows": typeof lib_claimLinkRows;
  "lib/config": typeof lib_config;
  "lib/conflicts": typeof lib_conflicts;
  "lib/contacts": typeof lib_contacts;
  "lib/design": typeof lib_design;
  "lib/domains": typeof lib_domains;
  "lib/editorial": typeof lib_editorial;
  "lib/email": typeof lib_email;
  "lib/georgian": typeof lib_georgian;
  "lib/guideStarters": typeof lib_guideStarters;
  "lib/imagekitServer": typeof lib_imagekitServer;
  "lib/imagekitSign": typeof lib_imagekitSign;
  "lib/juryProfile": typeof lib_juryProfile;
  "lib/listingHelpers": typeof lib_listingHelpers;
  "lib/mcpAudit": typeof lib_mcpAudit;
  "lib/mcpAuth": typeof lib_mcpAuth;
  "lib/media": typeof lib_media;
  "lib/mediaEntry": typeof lib_mediaEntry;
  "lib/publicRules": typeof lib_publicRules;
  "lib/push": typeof lib_push;
  "lib/quickSubmissions": typeof lib_quickSubmissions;
  "lib/r2": typeof lib_r2;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/reel": typeof lib_reel;
  "lib/resendApi": typeof lib_resendApi;
  "lib/revisions": typeof lib_revisions;
  "lib/scoring": typeof lib_scoring;
  "lib/socialApi": typeof lib_socialApi;
  "lib/taxonomy": typeof lib_taxonomy;
  "lib/teamAuth": typeof lib_teamAuth;
  "lib/time": typeof lib_time;
  "lib/tokens": typeof lib_tokens;
  "lib/utils": typeof lib_utils;
  "lib/voiceover": typeof lib_voiceover;
  listings: typeof listings;
  mcp: typeof mcp;
  media: typeof media;
  migrations: typeof migrations;
  notify: typeof notify;
  pendingActions: typeof pendingActions;
  publish: typeof publish;
  push: typeof push;
  pushSend: typeof pushSend;
  quickSubmit: typeof quickSubmit;
  rateLimits: typeof rateLimits;
  reels: typeof reels;
  reminders: typeof reminders;
  resendLog: typeof resendLog;
  rounds: typeof rounds;
  seed: typeof seed;
  seo: typeof seo;
  social: typeof social;
  tasks: typeof tasks;
  users: typeof users;
  voiceover: typeof voiceover;
  votes: typeof votes;
  votingEmails: typeof votingEmails;
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
