# Editing a post after it was made (contract)

Giorgi: "when I create a post I want to be able to edit it after", including
posts Claude drafted through the MCP connector. The backend (Convex + MCP) is
done; this is what the Studio's post sheet and Create's edit mode build on.
Nothing here publishes: editing only saves.

Files: `convex/lib/design.ts` (recipe validators and types),
`convex/lib/mediaEntry.ts` (lookups), `convex/media.ts` (`designs`,
`recentRenders`, `registerSocial`), `convex/graphics.ts` (recipes written at
render time), `convex/social.ts` (`get`, `update`, `listingMedia`),
`convex/mcp.ts` + `lib/mcp/server.ts` (MCP). Tests: `tests/postEditing.test.ts`.

## 1. Design recipes

Every render registers its media row with `design` (written in the same
mutation that records the file):

- `graphics.renderForPost` (Studio Create's "Render final"), single or carousel
- MCP `render_graphic` / `render_carousel` (`internal.graphics.render` / `renderCarousel`)
- `media.registerSocial({ ..., design? })` for a JPEG the browser uploads itself

Screenshots, uploads registered without `design`, quick voiceover reels and
every render made before this change have `design: null`. Reels rendered in the
reel editor have `design: { kind: "reel", recipe, draftId?, title? }` (section 7,
docs/reel-editor.md).

Types (import from `@/convex/lib/design`):

```ts
type GraphicDesign = {
  kind: "graphic";
  template: string;              // a TemplateId (lib/graphics/spec.ts)
  format: string;                // a FormatId
  style: string;                 // always set; "glass" when the render named none
  palette: string;               // a palette id or "auto"
  glass?: string;                // "frost" | "liquid" | "tint" (glass style; absent = frost)
  fields: Record<string, string>;// the texts as given (server fills defaults)
  imageUrls: string[];           // the template's image slots in order ([] = none)
};

type CarouselDesign = {
  kind: "carousel";
  listingId?: Id<"listings">;    // absent: told from facts only
  palette: string;
  style: string;                 // always set
  facts: Record<string, string>; // overrides (Studio: its carousel fields quote/juror/role/cta)
  story: { chips?: string[]; notes?: string[]; cta?: string; glass?: string; shots?: string[]; mobile?: string };
  slideIndex: number;            // 0-based place in its set
  slideName: string;             // "hook", "site", ..., "cta"
  total: number;                 // slides in the set
  setId: string;                 // shared by the slides rendered together (their ImageKit folder)
};

type MediaDesign = GraphicDesign | CarouselDesign;            // as stored
type DesignView = GraphicDesign | (CarouselDesign & { listingSlug: string | null }); // as returned

type MediaDetail = {
  url: string;
  mediaId: Id<"media"> | null;   // null: a file we don't hold (outside URL, old Convex file)
  kind: "image" | "video" | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;    // videos
  design: DesignView | null;
};
```

### Re-rendering from a recipe (Studio)

Call `graphics.renderForPost` (admin action) →
`{ urls: string[]; mediaIds: Id<"media">[]; width: number; height: number }`.
The new files get their own recipes automatically.

- graphic: `{ template, format, palette, style, glass, fields, imageUrls }` (same names).
- carousel: `{ template: "new_listing", format: "ig_portrait", palette, style,
  glass: story.glass, carousel: true, listingId, fields: facts,
  imageUrls: story.shots, story: { chips, notes, cta, mobile } }`.
  `story` (new, optional, carousel only) carries an MCP recipe's chips/notes/cta/mobile;
  `glass` and `imageUrls` win over `story.glass` / `story.shots`. A carousel always
  re-renders the whole set (new `setId`).

Errors (thrown as `Error`, show the message): `Unknown template / format /
palette / glass / style "x"`, `Give a listingId, or facts with at least a
title.`, `Listing not found.`, `Rendering failed (HTTP n) ...`, `Rendering the
carousel failed ...`, and the admin check.

## 2. Reading a post for the editor

`social.get({ id })` → `PostDetail` = the queue's `postView` plus:

```ts
mediaDetails: MediaDetail[];      // mediaDetails[i] describes media[i]
instagramProblem: string | null;  // why approval would refuse the media for Instagram
                                  // (feed post with an Instagram caption), e.g.
                                  // "Instagram needs an image or a video." or the
                                  // "between 4:5 and 1.91:1" message
```

`social.update` returns the same `PostDetail` (the saved state). Other
mutations still return `postView`; the live `social.get` query refreshes.

Other admin queries (Clerk session, `requireAdmin`; non-admins get an error):

- `media.designs({ urls: string[] })` → `MediaDetail[]` in the order given (at most 50: `At most 50 URLs at once.`).
- `media.recentRenders({ role?: "graphic" | "carousel", limit?: number })` →
  `{ id, kind: "image", role: "graphic" | "carousel", url, folder, contentType, size, width, height, createdAt, design: DesignView | null }[]`,
  newest first, images only, never invalid files. `graphic` = `/social/graphics`
  (renders and Studio uploads), `carousel` = carousel slides. Limit 1-100 (default 30).
- `social.listingMedia({ id })` → `{ kind, url, role: "screenshot" | "preview", width, height, durationSec }[]`:
  the post's listing's current screenshots (cover first) and preview video. `[]` without a listing.

## 3. Changing media: `social.update`

```ts
social.update({
  id,
  media?: { kind: "image" | "video"; url: string; role?: string; networks?: Network[] }[],
  placement?: "feed" | "story",
  baseMedia?: string[],          // NEW: media URLs (in order) the edit was made from
  captions?, publishAt?: number | null, note?,
}) → PostDetail
```

`media` replaces the whole list. Replace / reorder / remove / add = send the
new list. Send `baseMedia: post.media.map(m => m.url)` from the state you
edited, so an edit made over a newer version (other tab, Claude) is refused
instead of overwriting it. Do not send fields you don't change.

Building the list:

- **Replace one item**: same index, new `url` (and `kind`), keep `role` and `networks`.
  Roles: `"graphic"` (renders), `"carousel"` (slides), `"screenshot"`, `"upload"` (device image), `"hook"`.
- **Replace a carousel set** (recipe `kind: "carousel"`): the set is every item whose
  `mediaDetails[i].design?.setId` equals the edited one. Put the new slides where the
  first item of the set was (networks of that item, role `"carousel"`), drop the others
  of the set; an item of the set limited to `["threads"]` (the hook copy) becomes the new
  slide 0 with `networks: ["threads"]`, in its own place.
- **Add**: append (`mode=add`), at most 10 items in all.

Validation (ConvexError data string; show it with the existing `SheetError`):

| When | Message (start) |
| --- | --- |
| more than 10 items | `At most 10 images or videos per post.` |
| URL not https | `Media must be a public https URL: …` |
| role over 40 chars | `Item n: the role is longer than 40 characters.` |
| a network twice | `Item n names a network twice.` |
| file failed its upload check | `Item n failed the upload check (…). Upload or render it again.` |
| kind differs from the file | `Item n is an image, not a video (…).` / `Item n is a video, not an image (…).` |
| `baseMedia` differs | `This post's images changed since you opened it. Look again and redo the change.` |
| story, not one item (once it has media) | `A story is exactly one image or video (this one has n). …` |
| story, known size not 9:16 | `A story must be 9:16 (1080x1920), and … is WxH. Render it in the story format.` |
| story video outside 3-60 s | `A story video runs 3 to 60 seconds on Instagram and Facebook, …` |
| sent / rejected post | `This post is sent; it can't be changed any more.` |
| being published | `This post is being published right now; wait a few minutes.` |
| past publish time | `The publish time is in the past.` |

Story rules are checked on every update while the post is a story and has
media (an empty story is still being made). Switching feed → story: send
`placement: "story"` together with `media: [one 9:16 item]` in one call
(placement alone with several feed items is refused). Story → feed: any media.

Instagram feed ratio (4:5 to 1.91:1) is **not** refused by update (captions may
still change); approval refuses it. Show `instagramProblem` as a warning. An
ImageKit image outside the range is padded with white at publish: from
`mediaDetails[i].width/height` show "Padded with white on Instagram" when
`w/h < 0.8 || w/h > 1.91` and the post has an Instagram caption.

**Back to waiting**: any successful update of an `approved`, `scheduled` or
`failed` post sets it to `waiting` (scheduled publish cancelled, approval and
error cleared, publish time kept). Confirm first in the Studio
("This post goes back to Waiting. You approve it again after."). `waiting`
posts stay waiting. Editable = status waiting/approved/scheduled/failed and
not `publishing` (compare `publishingUntil` with the clock).

## 4. Uploading an image from the device

1. `graphics.finalUploadAuth({})` (admin action) → `{ token, expire, signature, publicKey, urlEndpoint, folder: "/social/graphics" }`.
2. Check in the browser: image only; convert to JPEG (canvas, ~0.9) unless it is
   JPEG or PNG; at most 5 MB after conversion; at most 4096 px a side (scale down).
3. `POST https://upload.imagekit.io/api/v1/files/upload`, FormData: `file`,
   `fileName` (e.g. `shemoqmedi-upload-<slug>.jpg`), `folder` = auth.folder,
   `useUniqueFileName: "true"`, `tags: "social,upload"`, `publicKey`, `signature`,
   `expire`, `token`. Answer: `{ fileId, url, filePath, size, width?, height? }`.
4. `media.registerSocial({ url, fileId, filePath, size, width, height, contentType, design? })`
   → `Id<"media">` (same id when registered again; adds `design` if the row had none).
   Errors: `That file is not in the social graphics folder. Render it again.`,
   `Invalid upload.`, `Social graphics are JPEG or PNG files.`, `Invalid image size.`,
   `Screenshots must be images of 5 MB or less.`
5. The uploaded image shows as a picked tile in the Upload tab; only the sheet's
   Add / Replace button saves it: `social.update` with `{ kind: "image", url, role: "upload" }`
   added/replaced (an edit can send the post back to Waiting, so choosing a file never saves).

ImageKit re-checks the file afterwards (`media.verify`); a bad file is flagged
invalid and drops out of `recentRenders`.

## 5. Create edit mode (URL contract)

- `/create?post=<postId>&item=<index>`: edit media item `index` (0-based) of the post.
- `/create?post=<postId>&mode=add`: make a new graphic and append it to the post.

Loading: `social.get({ id })`; `mediaDetails[item].design` is the recipe.

- graphic recipe → source from template (`award` → award, `new_listing`/`screenshot` →
  listing when the post has a listing, `announcement`, `call_*`, else free), output
  `story` when format is `story`, else `single`; template, format, style, palette,
  glass, fields; screenshot = `imageUrls[0]`. Every template field is seeded (the
  recipe's text or `""`) and a recipe without an image seeds "no screenshot" (`""`),
  so the loaded listing's facts and cover never fill them: an unchanged render gives
  the same graphic. A feed post's non-feed format (`reel_cover`, `story`) is kept
  while it stays chosen.
- carousel recipe → output `carousel`, source listing (award when the post kind is
  award), the recipe's own listingId only (a facts-only carousel stays facts-only,
  even on a post with a listing), palette, style, glass = `story.glass`, all four
  carousel fields from `facts` (`""` when absent: not the listing's jury note),
  screenshot = `story.shots[0]`; keep `story` to pass back on render.
- no recipe → best-effort prefill with a note ("No design saved for this image:
  starting from the post."): post kind → source/template, listing → source listing,
  facts / captions → fields (title, studio, tier, date, headline), the current image
  as the screenshot when it is a screenshot (role screenshot or a `/listings/` URL),
  output story when the post is a story.

Saving ("Update post", replaces steps 06/07): render with `renderForPost`, then
`social.update({ id, media: <list per section 3>, baseMedia })`. A story post's
edit renders `format: "story"`. Then `router.replace("/queue?post=<postId>")`
(the queue opens that post's sheet; the edit page leaves history). Cancel returns
to the same URL without saving. "Start over" (offered when the post's media changed
meanwhile) clears the edit draft and seeds again from the post as it is now: the
seed and the base media always come from the same copy of the post.
Edit-mode drafts use their own persist key (e.g. `create-edit:<postId>:<item|add>`),
never the normal `create` draft.

## 6. MCP (Claude connector)

- `get_post` → the post with `mediaDetails` (and `instagramProblem`), same shape as `social.get`.
- `get_designs({ urls })` (new) → `MediaDetail[]` (recipes of any URLs, e.g. from `list_media`).
- `render_graphic` / `render_carousel` record recipes; their descriptions and the
  server INSTRUCTIONS say how to edit a drafted post: read the recipe, render again
  with the change, `update_post` with the whole media list (new URL in place, roles and
  networks kept), show Giorgi, never approve or publish without a new yes.
- `update_post` follows the same media rules as `social.update` (no `baseMedia` there).

## 7. Reels (the reel editor)

The reel editor is in docs/reel-editor.md; this is how it meets posts.

- **Recipe.** A reel rendered in the editor is a video media row with
  `design: { kind: "reel", recipe, draftId?, title? }` (`social.get().mediaDetails[i].design`).
  Create's `seedFromRecipe` refuses it: reels open in the reel editor, never in Create.
- **Post sheet** (`components/studio/queue/MediaEditor.tsx`, helpers in `lib/studio/reelPost.ts`):
  - a video with a reel recipe shows **Edit reel**: `reels.openFromMedia({ url, postId })`
    (the draft behind it, or a new draft rebuilt from the recipe), then
    `/reels?draft=<id>&post=<postId>&item=<i>`;
  - any other https video shows **Make a reel**: `reels.create({ recipe: recipeFromVideo(...), title, postId })`
    (one clip: a listing preview is a silent `listingVideo`, anything else an `upload-video`
    with its sound on), then the same URL;
  - the Add row has **New reel**: `/reels?new=1&post=<postId>` (the draft is created with that `postId`);
  - renders not in the post yet (`reelOffers`, status `rendered` only): **Use it** replaces the
    item whose recipe names that draft, **Add** appends a reel made for this post (`draft.postId`),
    **Not for this post** clears `draft.postId`. Both save through `social.update` with `baseMedia`
    (section 3), with the usual back-to-Waiting confirm;
  - labels: reels are "Reel" (`itemTitle`, `formatText`, the "Reel · 24 s" chip on the card).
- **Routes** (`app/studio/reels/page.tsx`, read on the client from the address bar):
  - `/reels`: the Reels tab (reel drafts, recent reels, the quick voiceover reel);
  - `/reels?draft=<id>`: the editor with that draft (Claude's push links land here);
  - `/reels?draft=<id>&post=<postId>&item=<i>`: from a post; after rendering, **Replace in post** =
    `social.update({ id, media: <item i → { kind: "video", url, role: "reel", networks: old.networks }>, baseMedia })`
    (confirm first when the post is approved, scheduled or failed: it goes back to Waiting), then
    `router.replace("/queue?post=<postId>")`. If item i is no longer a video the reel is added instead;
  - `/reels?new=1[&post=<postId>]`: a new reel (for that post: **Add to post** appends it).
  - A new reel's first save rewrites `?new=1` to `?draft=<id>` with `history.replaceState(null, …)`
    (Next syncs it; the editor stays mounted). Back from the editor goes to the post, else to `/reels`.
- **New posts from a render**: "Post as reel" / "Post as story" (story: 9:16, 3 to 60 s) make a
  waiting `custom` post with `media: [{ kind: "video", url, role: "reel" }]` and draft captions from
  the reel's one listing. Nothing is approved or published.
- **MCP**: `create_reel_draft` / `update_reel_draft` (status "ready", push "Reel draft ready to
  render" → `/reels?draft=<id>`), `get_reel_draft`, `list_reel_drafts`, and
  `attach_reel { postId, draftId, replaceIndex?, keepOthers?, networks? }` (refused unless the draft
  is rendered and unchanged since; `update_post` rules). Claude cannot render: Giorgi renders a draft
  when he opens it. Home shows those drafts in "Ready to render".
