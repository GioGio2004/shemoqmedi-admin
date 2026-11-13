# Studio design system: Liquid Glass

The Studio (studio.shemoqmedi.space, `app/studio/*`, `components/studio/*`) is
an iOS 26 "Liquid Glass" app, light first, dark too. This is the contract the
screens build on. The source of truth for the look is the "Variant A — Light
liquid" mockup; the foundation below implements it with three mandatory
changes from Giorgi:

1. **No white bezel.** A glass surface is: translucent fill + blur/saturate, a
   crisp 0.5px hairline (`--st-ring`), the 1px top specular line (`--st-spec`),
   the soft sheen (`::before`) and the shadow. No white rim, no padded glass
   frame around cards, pictures, buttons or the tab bar, no tab-bar "lens".
   Pictures in cards sit **flush**, their corners rounded with the card.
2. **The crow is the logo.** `.st-crow` draws `public/icons/crow-mark.png`
   (transparent silhouette) as a CSS mask filled with `currentColor`: black in
   light mode, white in dark. Never the old "S" tile.
3. **No blue.** The accent is black in light mode, white in dark
   (`--st-accent`, the glossy primary, focus rings). Colour comes only from
   the posts' own artwork. Failed = muted red text or dot (`--st-danger`) only.
   The old `.st-btn-blue` / `data-tone="blue"` names are removed.

Copy is English, short and plain; no emoji in chrome.

## Files

| File | What |
| --- | --- |
| `app/studio/studio.css` | Tokens, surfaces, every shared class. Loaded by `app/studio/layout.tsx`. |
| `app/studio/screens/<screen>.css` | **Each screen's own styles** (see "Screen CSS" below). |
| `components/studio/liquid.ts` | Springs, `tween`, `Spring`, `animateSprings`, `rubber`, the delegated liquid press (`useLiquid`, mounted once by the shell). |
| `components/studio/Droplet.tsx` | `<Droplet>`, the stretching selection indicator. |
| `components/studio/ui.tsx` | `PageHead`, `Sheet`, `SheetError`, `ConfirmSheet`, `Switch`, `Segmented`, `Skel`, `Field`, `ErrorBoundary`. |
| `components/studio/Lightbox.tsx` | The picture view. |
| `components/studio/TimeSheet.tsx` | `TimeSheet` (wheels), `RejectSheet`. |
| `components/studio/Ambient.tsx` | `useAmbient(urls)` and the background layer. |
| `components/studio/Toasts.tsx` | Glass toasts for `showAlert` / `showError`. |
| `components/studio/chrome.ts` | `useStudioTitle`, `useStudioPortal`, `lockScroll` / `unlockScroll`, `trapTab`. |
| `components/studio/media.ts` | `ikUrl(url, w)`, `ikSrcSet(url, widths)`, `isVideoUrl(url)`. |
| `components/studio/theme.ts` | `useTheme()`, `useThemePref()`, `setThemePref(pref, from?)`. |
| `components/studio/StudioShell.tsx` | Top bar, tab bar / dock, ambient, settings, toasts, portal host, admin gate. |

## Tokens

All tokens live on `.st` (so they never reach the admin). Dark values apply
under `prefers-color-scheme: dark` unless `<html data-studio-theme="light">`,
or always with `<html data-studio-theme="dark">`. Never hard-code a colour in a
screen; use these.

| Token | Use |
| --- | --- |
| `--st-bg` | Page background (#f4f4f2 / #09090a). |
| `--st-ink`, `--st-ink-2`, `--st-ink-3` | Text: primary, secondary (64%), tertiary (40%). |
| `--st-hair` | 0.5px separators (`box-shadow: inset 0 -.5px 0 var(--st-hair)`). |
| `--st-glass`, `--st-glass-strong`, `--st-glass-thick`, `--st-glass-media` | Glass fills: regular, bars, sheets, chips over pictures. |
| `--st-btn-glass`, `--st-inset-bg`, `--st-chip-bg`, `--st-band`, `--st-ph` | Glass buttons, recessed groups, chips/counts, picker band, picture placeholder. |
| `--st-spec`, `--st-ring`, `--st-sheen`, `--st-sheen-2` | The glass recipe: top specular line, hairline, sheen gradient. |
| `--st-shadow-sm`, `--st-shadow`, `--st-shadow-lg` | Elevation. |
| `--st-accent`, `--st-on-accent` | Black / white (swap in dark). |
| `--st-pri-bg`, `--st-pri-shadow`, `--st-pri-sheen` | The glossy primary (buttons, droplet, Create, badges). |
| `--st-drop-bg`, `--st-drop-shadow` | The tab bar's light droplet. |
| `--st-danger` | Failed: muted red, text and dots only. |
| `--st-scrim` | Behind sheets. |
| `--st-pv-bg`, `--st-pv-ink`, `--st-pv-ink-2`, `--st-pv-hair` | Instagram / Facebook previews (white / black like the real apps). |
| `--st-media-ink` | Text on `--st-glass-media`. |
| `--st-font` | SF on Apple devices, Inter elsewhere. |
| `--st-safe-t/-b/-l/-r`, `--st-top-h` (56px), `--st-dock-w` (124px) | Layout. |
| `--spring-bouncy/-snappy/-gentle`, `--dur-bouncy/-snappy/-gentle` | Real springs as CSS `linear()` (set by `useLiquid`), with cubic-bezier fallbacks. Use as `transition: transform var(--dur-bouncy) var(--spring-bouncy)`. |

Old names still work (mapped): `--st-paper`, `--st-soft`, `--st-mute`,
`--st-line`, `--st-line-strong`, `--st-r`, `--st-r-lg`. `--st-blue` is gone.

## Surfaces

| Class | What |
| --- | --- |
| `.st-glass` | Regular glass (cards, groups). |
| `.st-glass-strong` | Denser (bars, toasts). |
| `.st-glass-thick` | Thickest, more blur (sheets, pickers). |
| `.st-glass-media` / `.st-mchip` | Small glass over pictures (status chip, counter, network glyphs). |
| `.st-inset` | A recessed group inside glass (settings rows, results), radius 22. |
| `.st-card`, `.st-tile`, `.st-panel`, `.st-empty` | Already glass. |

Each glass class sets `position: relative; isolation: isolate` and uses its
own `::before` for the sheen. Do not put another `::before` on them.

## Liquid interaction

Any element with class **`lq`**, and automatically every `.st-btn`,
`.st-icon-btn`, `.st-chip`, `.st-tab`, `.st-tab-create`, `.st-seg > button`,
`.st-net-tabs > button`, `.st-option`, `.st-lb-btn`, gets: press squash
(`.is-pressed`), jelly spring on release, a pointer-following specular
(`::after` at `--x/--y`) and a ripple (`.st-ripple` span). All delegated from
the `.st` root by `useLiquid` (mounted once in `StudioShell`); a press that
moves 24px lets go. Reduced motion: no squash, no ripple. These elements use
`overflow: hidden`, `transform` and `::after`; don't fight that (wrap instead).
Add `round` to a circular `.lq` for the deeper round squash.

## Text styles

`.st-eyebrow` (13/600, secondary; `<b>` inside is primary), `.st-h1` (the iOS
large title, 38px, 46px from 900px), `.st-h2` (20/700), `.st-h3` (16/700),
`.st-lede` (15/500 secondary), `.st-note` (13 secondary), `.st-danger-text`,
`.st-num`/`.st-tnum` (tabular numbers). Sections: `.st-sec` + `.st-sec-head`.
Layout helpers: `.st-stack`, `.st-stack-lg`, `.st-row`, `.st-between`,
`.st-scroll-x` (bleeds to the screen edge, snaps).

## Buttons, chips, badges

| Class | What |
| --- | --- |
| `.st-btn` | **Primary: glossy black** (glossy white in dark). 48px tall. |
| `.st-btn st-btn-ghost` (= `st-btn-glass`) | Secondary: clear glass. |
| `.st-btn st-btn-quiet` | Text button. |
| `.st-btn-sm` (44px), `.st-btn-block`, `.st-btn-danger` (red text) | Modifiers. |
| `data-busy="true"` on a `.st-btn` | Spinner, label hidden, no clicks. |
| `.st-icon-btn` | 44px glass circle (`.is-plain` without glass). |
| `.st-chip` (`.st-chip-sm`) | Glass pill, 44px; `aria-pressed="true"` turns it glossy black. |
| `.st-badge` (+ `data-tone="ink" \| "mute" \| "error"`) | 24px pill. `.st-badge-link` makes a 44x44 target. |
| `.st-dot` / `.st-sdot` (`data-tone="ok" \| "warn" \| "error" \| "live"`; `.is-ring`, `.is-failed`) | Status dots. |
| `.st-link` (`.st-link-danger`) | Underlined text link, 44px tall. |
| `.st-callout` (`data-tone="ok" \| "ink" \| "error"`) | A message block. |

Keep every tap target 44px or more.

## Inputs

`.st-input` on `input`, `textarea` (auto-grows, `field-sizing: content`) and
`select` (arrow drawn per theme). **16px text** so iOS never zooms; focus is a
2px ink ring. Wrap with `<Field label id aside? hint?>`. `.st-label`,
`.st-counter` (`data-state="near" | "over"`), `.st-search` (icon + pill input).

## Cards (visual first)

```tsx
<article className="st-card is-flush">
  <div className="st-card-media" style={{ aspectRatio: "4 / 5" }}>
    <div className="st-car-track">{/* one .st-car-slide per picture */}
      <button className="st-car-slide" type="button" aria-label="View picture 1 of 6">
        <img className="st-fade-img" src={ikUrl(url, 720)} srcSet={ikSrcSet(url)} sizes="(min-width: 900px) 420px, 100vw" width={w} height={h} alt="" />
      </button>
    </div>
    <div className="st-media-top"><span className="st-mchip">Waiting</span><span className="st-mchip">1/6</span></div>
    <div className="st-dots" aria-hidden="true"><i className="on" />…</div>
  </div>
  <div className="st-card-body">
    <div className="st-card-head"><h3 className="st-card-title">…</h3><span className="st-card-meta">Carousel · 6</span></div>
    <p className="st-card-text">…</p>
    <p className="st-card-error"><span className="st-sdot is-failed" />…</p>
  </div>
</article>
```

`.is-flush` drops the card padding and clips the picture to the card's
corners: no frame. Add `.is-loaded` to `.st-fade-img` in `onLoad` (and when
`complete` on mount). `.st-card.is-pressed` gives the card press (set it from
your own handler on the card's open button).

## Images: sizes and loading

- Always size through ImageKit: `ikUrl(url, width)` / `ikSrcSet(url)` from
  `components/studio/media.ts` (non-ImageKit URLs pass through).
- **Eager** (`loading` unset) for the first screen (the first two or three
  cards). `loading="lazy"` **only** on plain in-flow images further down,
  never on images inside animated / transformed / hidden containers (they may
  never load).
- Give `width`/`height` (or `aspect-ratio`) so nothing jumps.

## Segmented control and Droplet

```tsx
<Segmented
  label="Filter posts by status"          // or labelledBy="id"
  value={filter}
  onChange={setFilter}
  options={[{ value: "waiting", label: "Waiting", count: 4, id: "f-waiting", controls: "feed" }, …]}
  kind="tabs"                             // "tabs" (tablist) | "radio" (radiogroup)
  size="sm"                               // optional, smaller padding
  block                                   // optional, full width, equal options
/>
```

Glass capsule; the glossy droplet stretches from the old option to the new
(two edge springs). Arrow keys, Home and End move the choice; roving
tabindex. Without JS the selected option is drawn black.

`<Droplet track={ref} active={key} axis="x" | "y" className="st-droplet" />`
is the raw indicator for any custom group: put it as a child of a
`position: relative` track whose direct children carry `aria-selected` /
`aria-current="page"` / `aria-checked` / `data-active="true"`; `data-drop-skip`
on the active child hides it. The track gets `data-drop="on"` while placed.

## Sheet

```tsx
<Sheet
  open={open}
  onClose={() => setOpen(false)}         // called for Escape, backdrop, close button, swipe down
  title="Announcement"
  eyebrow="Waiting · Carousel · 6"       // optional
  subtitle="Irakli Inanishvili"          // optional
  size="large"                            // "auto" (fits content, default) | "large" (full height)
  detents                                 // with "large": also rests at a medium detent (44%)
  wide                                    // from 900px: 1040px two-column modal
  floating                                // rounded on all four corners, inset from the edges
  headerActions={<button className="st-icon-btn">…</button>}
  footer={<><button className="st-btn st-btn-ghost">Reject</button><button className="st-btn">Publish now</button></>}
>
  …scrolling content (.st-sheet-in, a grid with 16px gaps)…
</Sheet>
```

A native modal `<dialog>` (top layer, page inert, focus contained and
restored, Escape) with the iOS motion: spring up from the bottom; drag the
grabber/header, or the content from its top, with rubber-banding; a flick
snaps to the nearest detent or dismisses. From 900px a centred modal (no drag).
The page scroll is locked while open. Content mounts only while open, and
only once the dialog is shown, so its first effects measure a real box.
`footer` is pinned on glass; for in-content button rows use `.st-sheet-foot`.
Errors inside a sheet: `<SheetError error={err} />` (a toast shows over the
sheet too, but the inline error stays with the form). `ConfirmSheet` (`open onClose title body confirmLabel onConfirm`)
for yes/no. Two-column desktop layout inside a wide sheet is the screen's own
CSS (e.g. `grid-template-columns: minmax(0, 420px) minmax(0, 1fr)` at 900px).

## Lightbox

```tsx
{viewer && (
  <Lightbox
    items={post.media.map((m) => ({ url: m.url, w: m.width, h: m.height, kind: m.kind }))}
    start={viewer.index}
    origin={viewer.el}                          // the tapped slide/img (or a DOMRect): zooms out of it
    originFor={(i) => slideRefs.current[i]}     // optional: fly back into slide i on close
    onIndexChange={(i) => scrollCarouselTo(i)}  // optional
    label={post.label}
    onClose={() => setViewer(null)}             // after the closing motion; unmount then
  />
)}
```

Portalled into the Studio scope, a modal `<dialog>` (above any sheet). Swipe
between pictures, swipe down to close, double-tap / pinch / ctrl+wheel zoom
(click to zoom with a mouse, click beside to close), pan when zoomed, arrows
and Escape on the keyboard, "2 / 6" counter, open-original link, tap to hide
the chrome. Videos (`kind: "video"` or a video URL) play with their controls.

## Ambient background

```tsx
useAmbient(posts.slice(0, 4).map((p) => p.media[0]?.url));
```

Up to four picture URLs (videos are skipped) while the screen is mounted; the
shell draws them as slow, heavily blurred, low-opacity blobs under a wash and
grain (ImageKit `w-160`). With none: a soft neutral light. Reduced motion: no
drift.

## Top bar, title, tab bar

- `PageHead` (`index?`, `section`, `title`, `lede?`, `actions?`) renders the
  large title and hands `title` to the top bar, which shows it small and
  centred once the large title has scrolled under the bar. A screen without
  `PageHead` can call `useStudioTitle("Queue")` and mark its own `<h1>` with
  `data-large-title`.
- The top bar: crow + "Studio" (home link), theme button, Settings, and
  Admin ↗ from 900px. Fixed; `.st-main` already pads for it.
- The tab bar: floating glass capsule (Home, Queue with the waiting badge,
  the raised glossy Create, Reels, Reminders) with the light droplet on the
  current page; compacts while scrolling down; a left vertical dock with the
  crow on top from 900px (`.st-main` pads for it). Screens do nothing.
- Sticky things under the top bar: `top: calc(var(--st-safe-t) + var(--st-top-h))`.
- Bottom space for the tab bar is in `.st-main`; fixed bottom bars of a
  screen go above it: `bottom: calc(max(14px, var(--st-safe-b)) + 74px)`.

## TimeSheet

`<TimeSheet open onClose title confirmLabel initial? onPick intro? />`
(unchanged contract): a floating glass panel with suggestion chips, the
summary line, and iOS snap wheels (day / hour / minute) in Tbilisi time,
GMT+4. The day wheel reaches a year ahead. Past times are refused (the panel shakes). `onPick(at)` may be async;
errors stay in the sheet. `RejectSheet open onClose onReject` too.

## Toasts

Keep calling `showAlert(text, "success" | "error")` / `showError(err)` from
`components/admin/Alerts`. In the Studio they appear as glass capsules from
the top (the admin's corner stack stays hidden). While a modal dialog is
open, the toast host moves inside the topmost one, so toasts stay tappable
(everything outside a modal is inert). Inside an open sheet, show
outcomes in the sheet instead (`SheetError`, an inline `.st-callout`).

## Theme

`useTheme()` → `"light" | "dark"` in effect; `useThemePref()` →
`"system" | "light" | "dark"`; `setThemePref(pref, { x, y }?)` saves it on this
device (`localStorage["studio-theme"]`) and applies it (circular reveal from
the point). The layout's pre-paint script prevents a flash. Settings has
System / Light / Dark; the top bar toggles Light / Dark.

## Screen CSS convention

Each screen puts its own styles in `app/studio/screens/<screen>.css`
(`home.css`, `queue.css`, `create.css`, `reels.css`, `reminders.css`) and
imports it at the top of the screen's root component:

```tsx
// components/studio/queue/Queue.tsx
import "@/app/studio/screens/queue.css";
```

Rules for screen CSS: classes prefixed `st-<screen>-` (e.g.
`.st-queue-feed`), tokens only (no literal colours, no blue), glass via the
shared classes or the recipe (fill + blur + `inset 0 1px 0 var(--st-spec),
var(--st-ring), var(--st-shadow)`), no bezel, transform/opacity animations
with the `--spring-*` curves, `will-change` sparingly, a
`prefers-reduced-motion` fallback, and single-line rules. Don't restyle shared
classes from a screen file; extend with a modifier instead.

## Accessibility and platform rules

16px+ inputs; 44px targets; safe-area insets; visible focus (2px ink ring,
white on dark); dialogs labelled, Escape closes, focus returns; tablists with
roving tabindex; `aria-live` for changing counts and summaries; no visible
scrollbars anywhere (already global under `.st`); reduced-motion fallbacks
for every motion; `@supports not (backdrop-filter)` falls back to solid fills
(already in the tokens).
