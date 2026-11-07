# shemoqmedi-admin

Admin app for **shemoqmedi.space**, and home of the shared **Convex backend** (`convex/`).
The public site lives in the `shemoqmedi` repo and talks to the same Convex deployment.

Starter state: Next.js 16 + Tailwind 4 / shadcn, Clerk auth, Convex, next-intl (en/ka/ru), ImageKit uploads.

## What's wired

| Piece | Where |
| --- | --- |
| Sign-in / sign-up (Clerk) | `app/[locale]/sign-in`, `app/[locale]/sign-up` |
| Protected dashboard | `app/[locale]/dashboard`; route guard in `proxy.ts` |
| Clerk → Convex auth | `convex/auth.config.ts` (JWT template `convex`) + `components/ConvexProviderWithClerk.tsx` |
| Clerk → Convex user sync | `convex/http.ts` webhook `/clerk-users-webhook` → `convex/users.ts` |
| Auth helpers for Convex functions | `convex/authHelpers.ts` (`requireUser`, `requireAdmin`) |
| Image upload credentials | `app/api/upload-auth` (ImageKit) |
| Server-side Convex calls as the user | `lib/convexServer.ts` |

## Environment

`.env.local` (and Vercel):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT=
NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY=
IMAGEKIT_PRIVATE_KEY=
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
```

Platform roles (`users.role`: `admin` / `super_admin`) are set in Convex, never by Clerk data.
