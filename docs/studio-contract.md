# Studio build contract (shared by the parallel builders)

Plan: `C:\Users\khvic\.claude\plans\precious-soaring-cloud.md`. Each builder owns
the files listed under its workstream and must not edit files owned by another.
Anything that needs another workstream's code is wired later in the integration
step; do not stub it in someone else's file.

## WS1: publishing API and MCP (owner of: convex/social.ts, convex/publish.ts,
convex/lib/socialApi.ts, convex/channels.ts, convex/mcp.ts, lib/mcp/server.ts,
tests/publishing.test.ts, tests/socialDesk.test.ts, tests/studioApi.test.ts)

Clerk-session admin functions (requireAdmin / internal.users.assertAdmin):
- `social.get({ id }) → postView`
- `social.create({ kind, listingId?, facts?, captions?, media?, placement? }) → postView`
- `social.update({ id, captions?, media?, publishAt?: number | null, note?, placement? }) → postView`
- `social.publish({ id, at?: number }) → postView` (approve: now when `at` is absent/past, else scheduled)
- `social.unschedule({ id }) → postView` (scheduled → waiting, job cancelled)
- existing: `social.queue`, `social.waitingCount`, `social.approve`, `social.reject`, `social.retry`
- `social.channels({}) → ChannelView[]` (no tokens)
- `social.recent({ limit? }) → postView[]` (latest sent posts with their results)

Schema (WS1 adds): `socialPosts.placement?: "feed" | "story"` (absent = feed).
Story posts: exactly 1 media item; Instagram `media_type: "STORIES"` (image_url or
video_url), Facebook Page photo/video stories if the Graph API supports it,
otherwise skipped with a note; Threads/LinkedIn skipped for stories.

MCP tools (WS1 adds): `list_templates`, `list_palettes`, `publish_post({id, at?})`,
`unschedule_post({id})`, `list_media({kind?, role?, limit?})`, `find_reel({listingSlug})`;
`placement` on `create_post` / `update_post`. Palette descriptions built from
`PALETTE_IDS`. (`list_styles` and the `style` arg on render tools are wired in
integration once WS2 lands.)

## WS2: graphics engine (owner of: lib/graphics/**, app/api/graphics/**,
convex/graphics.ts, convex/media.ts, lib/palettes.ts, assets/fonts/**,
tests/graphics*.test.ts)

- `lib/graphics/spec.ts` exports `STYLES = ["glass","swiss","kinetic","magazine","bento"] as const`,
  `type Style`, `isStyle()`. Every template and the carousel accept `style` (default "glass").
- `internal.graphics.render({ template, format, palette, fields?, imageUrls?, glass?, style? }) → { url, mediaId, width, height }`
- `internal.graphics.renderCarousel({ listingId?, facts?, palette, story?, style? }) → { urls, mediaIds, slides }`
- `graphics.renderForPost` (admin action): same args as `render` plus `carousel?: boolean`
  and `listingId?` → `{ urls: string[], mediaIds, width, height }`.
- `graphics.finalUploadAuth` (admin action) + `media.registerSocial({ url, fileId, filePath, size, width, height, contentType })`:
  the browser uploads a final JPEG to ImageKit `/social/graphics` and registers it.
- `GET /api/graphics/assets?shot=&palette=&glass=&format=` (admin session or render key)
  → JSON `{ palette: {base,surface,accent}, light: boolean, back: dataUri, frost: dataUri, shot: dataUri }`,
  cached per input (Cache-Control private, max-age=600).
- Browser preview kit: `lib/graphics/preview.tsx` exports `<GraphicPreview template format
  palette style glass fields assets scale />` that renders the same template components as
  HTML (client-safe; no sharp/node imports), plus `previewFontFaces` CSS string.
- Speed work per the plan; log render timings in dev.

## WS4: PWA, push, mobile admin (owner of: convex/push.ts (+ "use node" helpers),
convex/reminders.ts, schema tables pushSubscriptions + reminders, hooks in
convex/listings.ts submit, convex/claims.ts submit, convex/notify.ts, convex/digest.ts
(none needed), app/manifest.ts, public/sw.js, next.config.ts headers, app/layout.tsx
viewport/metadata, components/pwa/**, components/admin/AdminShell.tsx, app/globals.css,
tests/push.test.ts)

- `internal.push.notifyAdmins({ title, body, url, tag? })` (action): sends to every admin
  subscription, deletes 404/410 ones. `url` is absolute (studio or admin host).
- `push.subscribe({ endpoint, keys: { p256dh, auth }, origin, userAgent? })`,
  `push.unsubscribe({ endpoint })`, `push.mySubscriptions({})`, `push.test({})` (admin).
- `reminders.create({ text, at })`, `reminders.list({})`, `reminders.remove({ id })` (admin);
  fires `notifyAdmins` at `at`.
- Hook points WS4 adds itself (outside WS1 files): listings submit, claims submit,
  notify.awardAnnounced (admin copy), notify.emptyDay, notify.noRoundWinner.
  Hooks in social.ts (queue waiting, morning digest), publish.ts (sent/failed) and
  channels.ts (token warnings) are added in integration.
- Env: Convex `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; Next
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Without them, push is a no-op (logged), never an error.
- Hosts: `STUDIO_ORIGIN` = https://studio.shemoqmedi.space, `ADMIN_APP_ORIGIN` =
  https://admin.shemoqmedi.space (exported from `lib/hosts.ts`, WS4 creates it).
- `app/manifest.ts` per host (reads `headers()`), maskable icon; remove `metadata.manifest`
  link to crow.webmanifest and delete that file.

## Shared rules
- Read AGENTS.md (Next 16 differs; docs in node_modules/next/dist/docs).
- No secrets printed; no deploy, no push, no `convex dev/deploy`; `npx convex codegen` is fine.
- All checks must pass in your worktree: `npx convex codegen`, `npx tsc --noEmit`,
  `npx eslint app components convex lib tests proxy.ts`, `npx vitest run`, `npm run build`.
- Commit on your branch when done.
