# shemoqmedi-admin

Admin app for **shemoqmedi.space**, and home of the shared **Convex backend** (`convex/`).
The public site lives in the `shemoqmedi` repo and talks to the same Convex deployment.

Stack: Next.js 16 + Tailwind 4, Clerk auth, Convex (database + file storage). English only.
Design: the Kencho Group admin layout in white and black only.

## Listing lifecycle

```
pending ──approve──▶ in_voting (7 days) ──close──▶ awarded | archived
   └──reject──▶ rejected          (in_voting can be unpublished → rejected)
```

1. A signed-in user submits a site on the public site's `/submit` (title, URL, tagline,
   category, technologies, creator tier, region, credit, desktop screenshot + optional mobile
   screenshot and hover video). Files go to Convex storage. It lands as `pending`.
   Express Fast-Track is shown on the site but disabled: the backend rejects
   `submissionTier: "express"`.
2. An admin reviews it under **Review** (`/review`) and either approves it (status
   `in_voting`, `publishedAt = now`, `votingEndsAt = now + 7 days`) or rejects it with a reason
   the owner sees on their account page.
3. While `in_voting`, the site is public, the jury score can be set on the review detail page,
   and signed-in users cast one community vote each.
4. When the window ends the listing is finalized: awards are assigned and it becomes `awarded`
   (at least one award) or `archived` (none). Scores are final from then on.

Public pages show `in_voting`, `awarded` and `archived` listings only.

## Scoring and awards

Four pillars, each 1.0–10.0: Design, Usability, Creativity, Code (`convex/lib/scoring.ts`).

| Value | Rule |
| --- | --- |
| Jury (editorial) average | mean of the 4 jury pillars |
| Community average | mean over all votes of each vote's 4 pillars |
| Final score | `0.6 × jury + 0.4 × community`; jury only while there are no votes; community only if there is no jury score |

Awards, decided when voting closes:

| Award | Rule |
| --- | --- |
| BSC, Best Solo Creation | creator tier `solo` and final ≥ 8.20 |
| SOTD, Site of the Day | final ≥ 8.50 |
| HM, Honorable Mention | final ≥ 7.50 and not SOTD |

## Cron

`convex/crons.ts` runs `listings.closeExpiredVoting` every 15 minutes: every `in_voting`
listing whose `votingEndsAt` has passed is finalized (awards assigned). An admin can also close
a window early from the review detail page ("Close voting now & assign awards").

## Claims

Imported and seeded sites have no owner. On the public site anyone signed in can press
"This is mine" on an unclaimed site or creator profile and send a message plus an optional
proof link (`claims.submit`). Admins decide under **Claims** (`/claims`): approving hands
ownership to the claimant (`ownerId` / `claimedBy`, `isClaimed: true`) and rejects competing
pending claims; rejecting requires a reason.

## Managing the showcase by hand

Every listing is curated by hand with screenshots you take yourself. The admin nav:
**Overview · Review · Add site · Creators · Users · Claims · Import**.

### Add a site (`/listings/new`)

Fill in the site (title, live URL, short description, category, up to 6 technologies), the
creator ("Made by" name, website, tier, region; a creator profile is created for a new name and
reused for an existing one), the lifecycle state (pending, live voting with its end date,
awarded with its awards, or archived), an optional jury score, and the media: desktop
screenshot (required, 16:10), mobile screenshot and hover video (optional). Files are uploaded
to Convex storage only when you save (`admin.createListing`). Limits: images 5 MB, video 10 MB.

### Edit a listing (`/review/<id>`)

Open any listing from **Review** (all statuses are tabs). The detail page has panels for:

- **Details** (`admin.updateListing`): title, page address (slug), URL, description, category,
  technologies, credit, tier, region, claimed state.
- **Lifecycle** (`admin.setLifecycle`): move the listing to any status: pending, live voting
  (with a voting end date), awarded (pick awards), archived or rejected (with a reason). Voting
  can also be closed early (`listings.closeVotingNow`), and community votes reset
  (`admin.resetVotes`).
- **Media** (`listings.replaceMedia`, `admin.removeMedia`): replace the desktop screenshot,
  replace or remove the mobile screenshot and hover video.
- **Jury score** (`listings.setEditorialScores`, `admin.clearEditorialScores`).
- **Delete** (`listings.remove`): deletes the listing with its files, votes and claims.

### Creators (`/creators`)

Every "Made by" profile with tier, region, location, claimed state and owner, and how many
listings use it. **Edit** opens an inline form (`admin.updateCreator`, only changed fields are
sent): name (renaming also updates "Made by" on its listings), profile address
(`/creators/<slug>`; old links stop working), tier, region, location, website, bio and the
claimed flag (unticking removes the owner). **Delete** (`admin.deleteCreator`) works only once
no listing uses the profile.

### Users and roles (`/users`)

Everyone who signed up, with their listings and votes. Set each user's role to **None**,
**Admin** or **Super admin** (`admin.setUserRole`). Admins can use the whole panel; only a super
admin can grant or remove super admin, and nobody can change their own role (so the panel can
never lock you out). The first admin still has to be created from the CLI (see below).

### Wiping the showcase

To start from an empty showcase (deletes every listing with its screenshots, votes and claims,
then every creator profile; users are kept). CLI only, works in batches, so repeat it until it
returns `done: true`:

```bash
npx convex run admin:wipeShowcase '{"confirm":"DELETE"}'
```

Add `--prod` to run it against production. In Windows PowerShell 5.1 the inner quotes are
stripped; run it from Git Bash, or escape them: `'{\"confirm\":\"DELETE\"}'`.

## Quick import

Admin page **Import** (`/seed`) keeps a URL importer (`importer.importUrls`) for fast,
approximate listings: up to 10 URLs (one per line) plus a credit name, creator tier, region,
category and technologies. Each URL is captured by Microlink (1600×1000 screenshot + title +
description, about 5–15 s each) and inserted as `pending` (review queue) or straight into
`in_voting` when "Publish straight into live voting" is on. Imported sites are unclaimed and
carry no scores or awards. Automatic screenshots often miss WebGL and intro-animation sites;
for those, use **Add a site** with your own screenshots.

The "Load flagship seed" panel was removed from the UI: the showcase is curated by hand and
nothing is seeded automatically. `convex/seed.ts` and `importer.seedFlagship` still exist for
the CLI only:

```bash
npx convex run importer:seedFlagship '{}' --identity '{"subject":"user_xxx"}'
```

Both importer actions require an admin identity (the admin's Clerk user id as `subject` when
run from the CLI). Microlink's free tier allows roughly 50 captures a day. For more, set an API
key on the deployment:

```bash
npx convex env set MICROLINK_API_KEY <key>
```

## What's where

| Piece | Where |
| --- | --- |
| Schema (users, creators, listings, votes, claims) | `convex/schema.ts` |
| Listings: submit, public reads, review, close voting | `convex/listings.ts` |
| Community votes | `convex/votes.ts` |
| Creator profiles | `convex/creators.ts` |
| Claims | `convex/claims.ts` |
| Admin-only listing, creator and user management | `convex/admin.ts` |
| Import + seed (Microlink) | `convex/importer.ts`, `convex/seed.ts` (seed is CLI only) |
| Scoring + awards (pure) | `convex/lib/scoring.ts` |
| Shared listing helpers | `convex/lib/listingHelpers.ts` |
| Categories, technologies, tiers, awards, limits | `convex/lib/taxonomy.ts` (copied to the site's `lib/taxonomy.ts`) |
| Cron | `convex/crons.ts` |
| Admin UI | `app/dashboard`, `app/review`, `app/review/[id]`, `app/listings/new`, `app/creators`, `app/users`, `app/claims`, `app/seed`, `components/admin/*` |
| Admin gate | `components/admin/useAdmin.ts` + `AdminShell` (UI) and `requireAdmin` / `users.assertAdmin` in every admin Convex function |
| Clerk → Convex auth | `convex/auth.config.ts` (JWT template `convex`) + `components/ConvexProviderWithClerk.tsx` |
| Clerk → Convex user sync | `convex/http.ts` webhook `/clerk-users-webhook` → `convex/users.ts` |
| Backend tests | `tests/*.test.ts` (`npm test`, runs on convex-test, no deployment needed) |

## Making someone an admin

Roles live in Convex (`users.role`), never in Clerk data. After the person has signed up once:

```bash
npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
```

Add `--prod` to run it against production. Use `"role": null` to remove access, or
`"super_admin"` for the owner. After that, roles can be managed in the admin under **Users**.

## Environment

`.env.local` (and Vercel):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_STOREFRONT_URL=https://www.shemoqmedi.space   # optional
```

Convex deployment env (`npx convex env set ...`):

```
CLERK_FRONTEND_API_URL=   # issuer of the Clerk instance BOTH apps use
CLERK_WEBHOOK_SECRET=     # signing secret of the Clerk webhook endpoint
MICROLINK_API_KEY=        # optional: raises the ~50 captures/day free Microlink limit
```

Both apps must use the **same Clerk instance**, or Convex rejects the other app's tokens.

## Develop

```bash
npm install
npx convex dev   # pushes convex/ to your dev deployment and regenerates types
npm run dev
npm test
```
