# shemoqmedi-admin

Admin app for **shemoqmedi.space**, and home of the shared **Convex backend** (`convex/`).
The public site lives in the `shemoqmedi` repo and talks to the same Convex deployment.

Stack: Next.js 16 + Tailwind 4, Clerk auth, Convex (database + file storage). English only.
Design: the Kencho Group admin layout in white and black only.

## Listing flow

1. A user signs up on the public site and lands on `/submit`.
2. They submit a site: title, URL, description, category, technologies, credit, desktop
   screenshot (+ optional mobile). Screenshots go to Convex file storage.
3. It appears here under **Review** (`/review`). An admin approves it (it goes live on the
   public grid within a minute) or rejects it with a reason the owner sees on `/account`.

## What's where

| Piece | Where |
| --- | --- |
| Listings: schema, submit, public reads, review | `convex/schema.ts`, `convex/listings.ts` |
| Categories + technologies (source of truth) | `convex/lib/taxonomy.ts` (copied to the site's `lib/taxonomy.ts`) |
| Review UI | `app/review`, `app/review/[id]`, `components/admin/*` |
| Admin gate | `components/admin/useAdmin.ts` (UI) + `requireAdmin` in every admin Convex function |
| Clerk → Convex auth | `convex/auth.config.ts` (JWT template `convex`) + `components/ConvexProviderWithClerk.tsx` |
| Clerk → Convex user sync | `convex/http.ts` webhook `/clerk-users-webhook` → `convex/users.ts` |
| Backend tests | `tests/listings.test.ts` (`npm test`, runs on convex-test, no deployment needed) |

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
```

Both apps must use the **same Clerk instance**, or Convex rejects the other app's tokens.

## Develop

```bash
npm install
npx convex dev   # pushes convex/ to your dev deployment and regenerates types
npm run dev
npm test
```
