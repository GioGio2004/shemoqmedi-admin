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

## Import and seed

Admin page **Import** (`/seed`):

- **Load flagship seed** (`importer.seedFlagship`) loads the launch listings in
  `convex/seed.ts`. Policy: only Giorgi Khvichia's own projects carry jury scores and awards;
  third-party sites enter live voting as unawarded, unclaimed nominees. URLs that are already
  listed are skipped, so it is safe to run twice.
- **URL importer** (`importer.importUrls`) takes up to 10 URLs (one per line) plus a credit
  name, creator tier, region, category and technologies. Each URL is captured by Microlink
  (1600×1000 screenshot + title + description, about 5–15 s each) and inserted as `pending`
  (review queue) or straight into `in_voting` when "Publish straight into live voting" is on.
  Imported sites are unclaimed and carry no scores or awards.

Both are Convex actions that require an admin identity. Run them from the admin UI, or from
the CLI by passing the admin's Clerk user id as the identity:

```bash
npx convex run importer:seedFlagship '{}' --identity '{"subject":"user_xxx"}'
```

Microlink's free tier allows roughly 50 captures a day. For more, set an API key on the
deployment:

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
| Import + seed (Microlink) | `convex/importer.ts`, `convex/seed.ts` |
| Scoring + awards (pure) | `convex/lib/scoring.ts` |
| Shared listing helpers | `convex/lib/listingHelpers.ts` |
| Categories, technologies, tiers, awards, limits | `convex/lib/taxonomy.ts` (copied to the site's `lib/taxonomy.ts`) |
| Cron | `convex/crons.ts` |
| Admin UI | `app/dashboard`, `app/review`, `app/review/[id]`, `app/claims`, `app/seed`, `components/admin/*` |
| Admin gate | `components/admin/useAdmin.ts` + `AdminShell` (UI) and `requireAdmin` / `users.assertAdmin` in every admin Convex function |
| Clerk → Convex auth | `convex/auth.config.ts` (JWT template `convex`) + `components/ConvexProviderWithClerk.tsx` |
| Clerk → Convex user sync | `convex/http.ts` webhook `/clerk-users-webhook` → `convex/users.ts` |
| Backend tests | `tests/*.test.ts` (`npm test`, runs on convex-test, no deployment needed) |

## Making someone an admin

Roles live in Convex (`users.role`), never in Clerk data. After the person has signed up once:

```bash
npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
```

Add `--prod` to run it against production. Use `"role": null` to remove access.

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
