# Reel editor (contract)

Giorgi: "videos and reels morphing should have a tool, fusion and everything,
editing possibility … I want to have what I mark and possibilities of choosing
to my will." A full reel editor in the Studio: several sources in one reel
("fusion"), a timeline, per-clip trims / speed / motion / fit / text /
transitions, voice + music + captions, a live preview and a final render in
the browser. **Every option is Giorgi's choice; nothing is forced; defaults are
sensible.** Nothing here publishes.

No servers: all video work happens in the browser (mediabunny 1.62.1 +
WebCodecs + canvas + Web Audio). Convex actions only call ElevenLabs and R2.
The design contract is docs/studio-glass.md (liquid glass, black/white accent,
never blue, no bezels, 16 px inputs, 44 px targets, safe areas, reduced motion,
reuse Sheet / Segmented / Switch / Lightbox / TimeSheet / Droplet / toasts).
English, short and plain.

Done (this part): the recipe type, defaults, validation and timeline math
(`lib/reel/recipe.ts`, `lib/reel/timeline.ts`, tests `tests/reelRecipe.test.ts`),
Convex validators (`convex/lib/reel.ts`), the backend (`convex/reels.ts`,
`convex/voiceover.ts`), MCP tools (`convex/mcp.ts`, `lib/mcp/server.ts`), tests
`tests/reels.test.ts`. The three builders below build on these and do not
change them (ask the orchestrator if one must change).

---

## 1. The REEL RECIPE

Plain JSON, versioned (`version: 1`). Import everything from
`@/lib/reel/recipe` (types, option lists, `LIMITS`, defaults, `validateRecipe`,
`normalizeRecipe`); Convex mirrors it in `@/convex/lib/reel` (`reelRecipe`
validator, kept equal by a compile-time check). Ids inside the recipe
(`mediaId`, `listingId`, `narrationId`, `audioId`) are plain strings.

```ts
type ReelAspect = "9:16" | "4:5" | "1:1" | "16:9"; // ASPECTS: 1080x1920 (default), 1080x1350, 1080x1080, 1920x1080
type SourceKind = "listingVideo" | "screenshot" | "graphic" | "upload-video" | "upload-image";
type Motion = "none" | "zoomIn" | "zoomOut" | "panLeft" | "panRight" | "panUp" | "panDown";
type Fit = "fill" | "blur" | "letterbox";      // crop to fill | fit over a blurred copy | fit on black
type TextPosition = "top" | "center" | "bottom";
type TextStyle = "glass" | "solid" | "light" | "shadow" | "headline";
type TextSize = "s" | "m" | "l";
type TransitionType = "cut" | "crossfade" | "dipBlack" | "dipWhite" | "morph"
  | "slideLeft" | "slideRight" | "slideUp" | "pushLeft" | "pushRight" | "pushUp";
type CaptionStyle = "glass" | "bold" | "highlight" | "box" | "light";
type CaptionPosition = "top" | "center" | "bottom";

type ClipSource = {
  kind: SourceKind;
  url: string;            // https (R2 / ImageKit; CORS allows the Studio)
  mediaId?: string;       // Id<"media">
  listingId?: string;     // Id<"listings">
  listingSlug?: string;
  label?: string;         // "Paper Weather preview"
  width?: number; height?: number;
  durationSec?: number;   // videos: the file's length
};

type ReelClip = {
  id: string;             // [A-Za-z0-9_-]{1,40}, unique in the recipe (newClipId())
  source: ClipSource;
  inSec: number; outSec: number;  // videos: trim in seconds of the source; stills: 0, 0
  durationSec: number;            // stills: seconds on screen; videos: 0
  speed: number;                  // videos 0.5-2; stills 1
  motion: Motion;
  fit: Fit;
  text: { on: boolean; text: string; position: TextPosition; style: TextStyle; size: TextSize };
  transitionIn: { type: TransitionType; durationSec: number }; // first clip: treated as a cut
  audio: { on: boolean; gain: number };                        // videos: own sound
};

type CaptionWord = { text: string; startSec: number; endSec: number };
type CaptionLine = { text: string; startSec: number; endSec: number; words?: CaptionWord[] };
// caption times are seconds from the START OF THE NARRATION (reel time = voice.startSec + t)

type VoiceTrack = {
  narrationId?: string;   // Id<"reelAudio">
  url?: string;           // the MP3; absent = script not voiced yet (render refuses)
  script?: string; voice?: string; durationSec?: number;
  startSec: number;       // where on the reel it starts
  gain: number;
  captions: { on: boolean; style: CaptionStyle; position: CaptionPosition; lines: CaptionLine[] };
};

type MusicTrack = {
  audioId?: string;       // Id<"reelAudio">
  url: string; title?: string; durationSec?: number;
  offsetSec: number;      // start this far into the track
  gain: number;
  loop: boolean;          // start again when it ends before the reel
  duck: { on: boolean; amount: number }; // 0..1: how far it goes down under the voice
};

type ReelRecipe = {
  version: 1;
  reel: { aspect: ReelAspect; fps: 30 };
  clips: ReelClip[];
  audio: { voice: VoiceTrack | null; music: MusicTrack | null; clipGain: number; evenLoudness?: boolean }; // clipGain: master of clips' own sound; evenLoudness: absent = on
  fades: { videoInSec: number; videoOutSec: number; audioInSec: number; audioOutSec: number };
};
```

### Defaults (`defaultRecipe`, `defaultClip(source, aspect, id?)`, `defaultVoice`, `defaultMusic`)

| Field | Default |
| --- | --- |
| aspect / fps | 9:16, 30 |
| video clip | inSec 0, outSec = min(source length, 15) (8 when unknown), speed 1, motion none |
| still clip (screenshot, upload-image) | 3 s, motion zoomIn |
| graphic | 3 s, motion none |
| fit | fill when the source's shape is within 10% of the reel's, else blur (unknown size: blur) |
| text | off, "", bottom, glass, m |
| transitionIn | crossfade 0.4 s |
| clip sound | off for listing previews (silent recordings), on for upload-video; gain 1 |
| voice | startSec 0, gain 1, captions on, bold, bottom |
| music | offset 0, gain 0.5, loop on, duck on 0.6 |
| clipGain | 1 |
| evenLoudness | on: the finished mix goes to -14 LUFS (BS.1770 integrated, Instagram's level) with a look-ahead limiter keeping sample peaks under -1.5 dBFS (`lib/reel/loudness.ts`). It runs inside `mixAudio`, so the preview plays as loud as the render. Off: the volumes play exactly as set. |
| fades | video in 0, video out 0, audio in 0, audio out 0.5 |

### Validation

`validateRecipe(recipe, { forRender? }) → string[]` (empty = fine), messages
for people, e.g. `Clip 2: the end must be after the start.`. Convex runs it on
every save (`reels.create/update`, MCP) and with `forRender` on
`registerRender`. Rules (`LIMITS`): at most 40 clips; https URLs (≤ 2048);
unique ids; video `0 ≤ inSec < outSec ≤ source.durationSec` (+0.05), speed
0.5-2, at least 0.3 s on the timeline; stills 0.5-30 s; known options only;
text ≤ 200 chars; transitions 0-2 s; gains 0-2; duck 0-1; fades 0-5 s; total
clip length ≤ 180 s; voice needs `url` or `script` (script ≤ 1200), caption
lines ≤ 400 of ≤ 120 chars with `endSec > startSec`; `forRender`: at least one
clip and the voice voiced (`url`).

`recipeWarnings(recipe, reelSec)` gives notes that never block (narration runs
past the end and is cut, captions on but empty, > 90 s is too long for a
story, < 3 s too short for Instagram, a text on but empty).

`normalizeRecipe(loose) → ReelRecipe` fills defaults and clamps numbers; throws
`ReelRecipeError` when it can't (no clips list, a clip without a source / URL,
unknown source kind, another version). It is the migration point for future
versions. `clampToSource(clip, realSec)` keeps a trim inside a probed video.

## 2. Timeline semantics (`lib/reel/timeline.ts`)

- **Length on the reel**: `clipLength(clip)` = videos `(outSec - inSec) / speed`, stills `durationSec`.
- **Transitions overlap**: clip i+1 starts `transIn` seconds before clip i
  ends. `transIn = effectiveTransition(type, asked, prevLen, nextLen)` = 0 for a
  cut, else `min(asked, 2, prevLen/2, nextLen/2)` (never three clips at once).
  The first clip has none. `buildTimeline(recipe) → { items: TimelineItem[], durationSec }`
  (`start`, `end`, `length`, `transIn`, `transOut` per clip). The reel lasts
  until the last clip ends; the voice and music are cut there.
- **What shows at t**: `frameAt(timeline, t) → { a, b, transition }`: `a` the
  clip on screen (or the outgoing one), `b` the incoming one during a
  transition, each `Layer = { item, localSec, progress 0..1, sourceSec }`;
  `sourceSec = inSec + localSec * speed` (clamped inside the trim). Frames:
  `frameCount(duration)`, `frameTime(i)` (30 fps).
- **Fit**: `fitRect(fit, srcW, srcH, W, H)` (fill = `coverRect`, blur/letterbox =
  `containRect`). blur draws `coverRect` behind, blurred (about 4% of the width)
  and slightly darkened; letterbox draws black behind.
- **Motion**: `motionAt(motion, progress) → { scale, dx, dy }`: scale around
  the frame centre, then shift by dx·W, dy·H. Zooms 1 ↔ 1.12; pans at 1.12
  move ±6% (no edge shows). Linear. Applied after fit, to the main picture
  (blur background stays still).
- **Transitions**: `transitionLook(type, p) → { a: LayerLook, b: LayerLook, overlay }`,
  `LayerLook = { alpha, dx, dy, scale, blur }` (dx/dy in frame sizes, blur as a
  fraction of the width). Draw a, then b, then the overlay colour. Slides and
  pushes ease in-out; morph = zoom-blur.
- **Video fades**: `videoFadeAt(t, dur, in, out)` = black overlay alpha, drawn last.
- **Audio**: everything mixed at 48 kHz stereo.
  - voice at `voice.startSec`, × `voice.gain`, cut at the reel's end;
  - music from `offsetSec` (looped when `loop`), × `music.gain` × `duckAt(t, speechWindows(voice), duck.amount)` when duck is on;
  - each video clip with `audio.on`: its sound from `inSec` at its `speed`
    (pitch may change; fine), × `clip.audio.gain` × `audio.clipGain`, during
    its timeline window, crossfading with the transition (out-going × (1-p),
    incoming × p);
  - the whole mix × `audioFadeAt(t, dur, audioInSec, audioOutSec)`; clamp to [-1, 1].
  - `speechWindows` uses the captions' timed words (pauses > 0.8 s let the music
    up) or the whole narration; `duckAt` ramps over 0.25 s.
- **Captions**: `captionAt(lines, t - voice.startSec) → { index, line, word }`
  (`word` = the word being said, -1 when the line has no timings).
  `wordsToLines(words, { maxChars 28, maxSec 2.6, gapSec 0.6 })` makes lines
  (also breaks after . ! ? …). `estimateWords(script, durationSec)` spreads a
  narration without timings. `editCaptionText(line, text)` keeps word timings
  when the word count is the same, else drops them (the line shows whole).

### Safe zones (9:16)

Instagram covers the top ~12% and the bottom ~22% of a reel. Texts and
captions at `top` sit below 12%, at `bottom` above 22% (4:5, 1:1, 16:9: 6% each
side). Text and captions wrap to at most 2 lines (captions) / 3 lines (texts)
within 84% of the width.

## 3. ENGINE (Builder A: renderer)

Files (Builder A owns them): `lib/reel/compositor.ts`, `lib/reel/frames.ts`,
`lib/reel/audio.ts`, `lib/reel/render.ts`, `lib/reel/probe.ts`,
`lib/reel/fonts.ts` (optional), `lib/reel/index.ts` (re-exports),
`components/studio/reels/PreviewPlayer.tsx`, tests `tests/reelEngine.test.ts`
(pure parts: layout math, mixing math with fake buffers). Read
`node_modules/mediabunny` docs/types before using it; reuse the settings of
`lib/voiceoverMux.ts` (H.264, AAC 48 kHz stereo 128 kb/s, fast start, 2 s GOP).

### Exports

```ts
// lib/reel/frames.ts — pictures for the compositor
export interface FrameProvider {
  /** Get what frame f needs ready (decode / seek / load). The render awaits it every frame; the preview may skip. */
  prepare(frame: Frame, signal?: AbortSignal): Promise<void>;
  /** The picture of a layer now (stills: the image; videos: the frame at layer.sourceSec), or null when not ready. */
  image(layer: Layer): { source: CanvasImageSource; width: number; height: number } | null;
  dispose(): void; // close every VideoFrame / VideoSample / ImageBitmap it holds
}
export function createRenderFrames(recipe: ReelRecipe): FrameProvider;  // mediabunny: Input(UrlSource) + VideoSampleSink/CanvasSink, frame-exact, memory-safe
export function createPreviewFrames(recipe: ReelRecipe): FrameProvider; // <video>/<img> elements (or mediabunny on desktop), near real time

// lib/reel/compositor.ts — ONE drawing function for preview and render
export function drawFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  recipe: ReelRecipe,
  t: number,
  frames: FrameProvider,
  opts?: { timeline?: Timeline; scale?: number }, // scale = canvas width / reel width (preview draws smaller)
): void;
// draws: background black → layers a/b (fit, blur bg, motion, transition look) → clip text
// → captions (style, position, highlight word) → transition overlay → video fade.
// A layer whose image is null: keep it black (render never sees null: prepare() waited).

// lib/reel/probe.ts — for the editor
export function probeSource(url: string): Promise<{ width: number; height: number; durationSec: number | null; hasAudio: boolean }>;
export function sourceThumbnails(url: string, times: number[], maxWidth: number, signal?: AbortSignal): Promise<ImageBitmap[]>; // trim scrubber filmstrip
export function frameAtSource(url: string, sec: number, maxWidth: number): Promise<ImageBitmap>;   // frame-accurate scrubber

// lib/reel/audio.ts
export function mixAudio(recipe: ReelRecipe, durationSec: number, signal?: AbortSignal): Promise<AudioBuffer>; // OfflineAudioContext 48 kHz stereo, rules of section 2
// Decoded sources are cached by URL (the preview re-mixes when an audio field changes, debounced).

// lib/reel/render.ts
export type RenderSupport = { ok: boolean; reason: string | null }; // reason for people
export function renderSupport(): Promise<RenderSupport>;
//   no VideoEncoder/H.264 → "This browser can't make videos. Open the Studio in Chrome or Edge on a computer."
//   no AAC (common on iPhone) → "This browser can't encode the sound (AAC). Render on a computer in Chrome or Edge."
export type RenderProgress = { stage: "Preparing" | "Mixing sound" | "Rendering" | "Finishing"; fraction: number }; // 0..1 overall
export class RenderError extends Error { code: "unsupported" | "too-big" | "cancelled" | "source" | "encode" }
export function render(
  recipe: ReelRecipe,
  onProgress: (p: RenderProgress) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; width: number; height: number; durationSec: number }>;
// validateRecipe(recipe, { forRender: true }) first (RenderError "source" with the first message).
// Output: ASPECTS size, 30 fps, H.264 (~8 Mb/s 9:16, keyframe every 2 s), AAC 48 kHz stereo,
// fast start MP4. > 100 MB → RenderError "too-big". Cancel via signal → "cancelled".
// Memory: close every VideoFrame / VideoSample / AudioData as soon as it is encoded; one
// OffscreenCanvas; frames.dispose() in finally.
```

### PreviewPlayer (`components/studio/reels/PreviewPlayer.tsx`)

```tsx
type PreviewPlayerProps = {
  recipe: ReelRecipe;
  time: number;                        // controlled playhead (s)
  playing: boolean;
  onTime: (t: number) => void;         // while playing (rAF), and when it ends (at durationSec)
  onPlayingChange: (playing: boolean) => void; // false at the end
  className?: string;
};
export function PreviewPlayer(props: PreviewPlayerProps): JSX.Element;
```

- A canvas in the reel's aspect, filling its box (no bezel), drawn with
  `drawFrame` at ≤ 1080 px (≤ 540 on phones, `scale` passed). Same compositor as
  the render: preview == output.
- Plays the `mixAudio` buffer through an AudioContext; the clock is the audio
  clock (video follows; when a frame isn't ready it keeps the last one).
- Paused + `time` changes (scrub, selecting a clip) → draws that frame once its
  sources are ready. Shows a quiet "Loading clips" state until the first frame.
- `prefers-reduced-motion`: never autoplays (Ken Burns etc. still render as
  they will look in the reel).
- Degrades: if the device can't keep up it drops preview frames, never audio.

## 4. EDITOR (Builder B: editor UI)

Files (Builder B owns them): `components/studio/reels/editor/*`
(`ReelEditor.tsx`, `Timeline.tsx`, `ClipSheet.tsx`, `SourcePicker.tsx`,
`AudioSheet.tsx`, `CaptionsSheet.tsx`, `RenderSheet.tsx`, …),
`app/studio/screens/reel-editor.css`, `lib/studio/reelEditor.ts` (pure state:
reducer + selectors, tested in `tests/reelEditor.test.ts`),
`lib/studio/reelRender.ts` (background render job, like `lib/studio/reelBuild.ts`).

### State and actions (`lib/studio/reelEditor.ts`)

```ts
type EditorState = {
  draftId: Id<"reelDrafts"> | null;
  baseUpdatedAt: number | null;   // the draft's updatedAt last saved / loaded
  title: string;
  recipe: ReelRecipe;
  selected: string | null;        // clip id
  time: number; playing: boolean;
  dirty: boolean;                 // unsaved changes
  past: ReelRecipe[]; future: ReelRecipe[]; // undo / redo (cap 50)
};
type EditorAction =
  | { type: "load"; draft: DraftView }
  | { type: "addClips"; sources: ClipSource[]; at?: number }           // defaultClip per source
  | { type: "moveClip"; id: string; to: number }                       // drag (touch + mouse) and ↑/↓ buttons
  | { type: "duplicateClip"; id: string } | { type: "removeClip"; id: string }
  | { type: "updateClip"; id: string; patch: Partial<Omit<ReelClip, "id" | "source">> }
  | { type: "probed"; id: string; sourceSec: number; width: number; height: number } // clampToSource
  | { type: "setAspect"; aspect: ReelAspect }
  | { type: "setVoice"; voice: VoiceTrack | null } | { type: "patchVoice"; patch: Partial<VoiceTrack> }
  | { type: "setCaptions"; patch: Partial<Captions> } | { type: "editCaption"; index: number; text: string } // editCaptionText
  | { type: "setMusic"; music: MusicTrack | null } | { type: "patchMusic"; patch: Partial<MusicTrack> }
  | { type: "setClipGain"; gain: number } | { type: "setFades"; patch: Partial<ReelFades> }
  | { type: "setTitle"; title: string }
  | { type: "seek"; time: number } | { type: "play" } | { type: "pause" } | { type: "select"; id: string | null }
  | { type: "undo" } | { type: "redo" } | { type: "saved"; draft: DraftView };
```

Every recipe change goes through `validateRecipe` for inline messages (never
blocks editing). Saving: debounced (~1 s) `reels.update({ id, recipe, title,
baseUpdatedAt })`; a new reel is created on the first change
(`reels.create`). On "changed since you opened it": offer "Load the newer
version" (reload) — never overwrite silently. Unsaved changes are also kept on
the device (`createDraftStore("reel-editor")`) so a reload loses nothing.

### What the editor offers (every option is Giorgi's)

- **Sources sheet** (`SourcePicker`): Listings (`reels.listings({ text })`,
  then `reels.listingSources({ listingId })`: preview video + screenshots;
  pick several, from several listings), Graphics (`media.recentRenders({})`,
  as title cards, kind `graphic`), Uploads (`reels.uploads({})` + "Upload
  video" / "Upload image"), each added with `defaultClip`. New video sources
  are probed (`probeSource`) and clamped.
  - Upload video: `reels.uploadUrl({ contentType, size, listingId? })` →
    `PUT uploadUrl` with header `content-type` = the file's type →
    `reels.registerUpload({ key, contentType, size, width, height, durationSec })`
    → source `{ kind: "upload-video", url, mediaId }`. MP4 / MOV / WebM ≤ 200 MB
    (compress first with `lib/videoUpload.ts` when larger than needed).
  - Upload image: the existing ImageKit path (docs/post-editing.md §4:
    `graphics.finalUploadAuth` → ImageKit → `media.registerSocial`) → source
    `{ kind: "upload-image", url, mediaId, width, height }`.
- **Timeline**: clips in order as cards with a thumbnail and length; drag to
  reorder (pointer events: touch + mouse, long-press on touch), plus move
  left/right buttons, duplicate, delete; the transition into each clip shows
  between cards (tap to change); a playhead; total length.
- **Clip sheet**: trim in/out with a frame-accurate scrubber (filmstrip from
  `sourceThumbnails`, exact frame from `frameAtSource`, step ±1 frame),
  duration (stills), speed 0.5-2 (Segmented 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 or
  a slider), motion, fit, text (Switch on/off, text field 16 px, position,
  style, size), transition in (type + duration 0.1-2 s), clip sound (Switch +
  volume, videos only).
- **Reel**: aspect Segmented (9:16 / 4:5 / 1:1 / 16:9), fades.
- **Audio sheet**: Voice: write a script (word budget at 2.5 words/s of the
  reel's length), narrator (`voiceover.voices`), "Generate voice" (confirm: it
  spends ElevenLabs credits) → `voiceover.generateTimed({ script, voice,
  listingId? })` → `{ id, url, durationSec, words, script, voice }` → voice
  `{ narrationId: id, url, durationSec, script, voice, captions.lines: wordsToLines(words ?? estimateWords(script, durationSec)) }`;
  or pick an earlier one (`voiceover.narrations({ listingId? })`); start time,
  volume, off. Music: upload MP3/M4A (`reels.uploadUrl` + PUT +
  `reels.registerUpload({ ..., title: file name, durationSec })` →
  `{ audioId, url }`) or pick (`reels.music({})`); start in the track, volume,
  loop, ducking (Switch + amount). Clip sound master (`clipGain`).
- **Captions sheet**: on/off, style, position, each line's text editable
  (`editCaptionText`), "Make again from the voice".
- **Render sheet**: `renderSupport()` first (clear message when it can't);
  progress + Cancel; then `reels.renderUploadUrl({ size, draftId })` → PUT
  (`video/mp4`, `uploadReel` in `lib/voiceoverMux.ts` works) →
  `reels.registerRender({ key, size, width, height, durationSec, recipe, draftId, draftUpdatedAt })`
  → `{ mediaId, url }`. Runs in `lib/studio/reelRender.ts` (survives leaving the
  page, beforeunload while running, like `reelBuild.ts`). After: "Use in a
  post" (new post: `social.create({ kind: "custom", media: [{ kind: "video", url, role: "reel" }], placement })`,
  story when 9:16 and 3-60 s) or "Replace in post" (section 6).

## 5. Backend API (done)

All Studio functions are admin-only (Clerk session; others get an error).

### Drafts — `convex/reels.ts`

```ts
type DraftSummary = {
  id: Id<"reelDrafts">; title: string;
  status: "draft" | "ready" | "rendered"; // ready = made/changed by Claude, waiting for a render
  createdBy: "studio" | "claude"; note: string | null; postId: Id<"socialPosts"> | null;
  listingIds: Id<"listings">[]; aspect: string; clipCount: number; durationSec: number;
  cover: { kind: "image" | "video"; url: string } | null; // first clip's source
  renderedUrl: string | null; mediaId: Id<"media"> | null; renderedAt: number | null;
  createdAt: number; updatedAt: number;
};
type DraftView = DraftSummary & { recipe: ReelRecipe; problems: string[]; warnings: string[] };
```

| Function | Args → result |
| --- | --- |
| `reels.list` (query) | `{ status?, limit? 1-100 = 50 }` → `DraftSummary[]`, last changed first |
| `reels.get` (query) | `{ id }` → `DraftView \| null` |
| `reels.create` | `{ recipe, title?, note?, postId? }` → `DraftView` (status draft; title default "<first listing> reel" / "New reel") |
| `reels.update` | `{ id, recipe?, title?, note?, postId?: id \| null, baseUpdatedAt? }` → `DraftView`. A recipe change → status draft (the last render stays as renderedUrl). Stale base → `This reel changed since you opened it …` |
| `reels.duplicate` | `{ id }` → `DraftView` ("… (copy)", draft, no render) |
| `reels.remove` | `{ id }` → null (the render and posts stay) |
| `reels.openFromMedia` | `{ url, postId? }` → `Id<"reelDrafts"> \| null`: the draft behind a rendered reel (design.draftId), or a new one from its recipe (status rendered); null when the URL has no reel recipe |
| `reels.listings` (query) | `{ text?, limit? 1-200 = 60 }` → `{ id, slug, title, creditName, status, coverUrl, hasVideo }[]` |
| `reels.listingSources` (query) | `{ listingId }` → `{ id, slug, title, creditName, video: SourceFile \| null, screenshots: SourceFile[] } \| null`, `SourceFile = { url, mediaId, width, height, durationSec }` (nulls when unknown) |
| `reels.uploads` (query) | `{ limit? }` → uploaded videos `{ id, url, contentType, size, width, height, durationSec, createdAt }[]` |
| `reels.music` (query) | `{ limit? }` → `{ id, url, title, durationSec, size, createdAt }[]` |
| `reels.uploadUrl` (action) | `{ contentType, size, listingId? }` → `{ uploadUrl, key, url, kind: "clip" \| "music" }`; video/mp4, video/quicktime, video/webm ≤ 200 MB; audio/mpeg, audio/mp4 (x-m4a, aac) ≤ 20 MB; key `social/<slug or reels>/<slug>-clip\|music-<10 hex>.<ext>` |
| `reels.registerUpload` | `{ key, contentType, size, width?, height?, durationSec?, title? }` → `{ kind, url, mediaId, audioId }` (video → media row; music → reelAudio row). Checked on R2 afterwards; bad files are flagged and disappear from the lists |
| `reels.renderUploadUrl` (action) | `{ size ≤ 100 MB, draftId?, listingId? }` → `{ uploadUrl, key }` (`social/<first listing slug or reels>/…-reel-<id>.mp4`) |
| `reels.registerRender` | `{ key, size, width, height, durationSec, recipe, draftId?, draftUpdatedAt? }` → `{ mediaId, url }`. Media row (role reel) with `design: { kind: "reel", recipe, draftId, title }`; the draft → rendered when the rendered recipe is still the draft's (a rename or note meanwhile doesn't matter; a recipe edited meanwhile keeps its newer status but records the render; `draftUpdatedAt` is ignored). Refuses a recipe that can't render. R2 check afterwards (`voiceover.verifyReel`) |

Errors are `ConvexError` strings: show them as they are.

### Narration — `convex/voiceover.ts`

| Function | Args → result |
| --- | --- |
| `voiceover.voices` (action) | `{}` → `{ voices: { name, voiceId, description?, previewUrl? }[], wordsPerSecond }` (as before) |
| `voiceover.generateTimed` (action, spends credits) | `{ script, voice, listingId? }` → `NarrationView`. ElevenLabs `with-timestamps`; MP3 on R2 `social/<slug or reels>/…-voiceover-….mp3` |
| `voiceover.narrations` (query) | `{ listingId?, limit? }` → `NarrationView[]` newest first (also the quick reel's / MCP narrations, `words: null`) |

`NarrationView = { id: Id<"reelAudio">, url, durationSec, script: string | null, voice: string | null, listingId: Id<"listings"> | null, words: CaptionWord[] | null, createdAt }`.

`voiceover.generate` / MCP `create_voiceover` (the quick reel) are unchanged
except that they also keep the narration (`narrationId` in their result).

### Media recipes

`media.design` may now be `{ kind: "reel", recipe: ReelRecipe, draftId?: Id<"reelDrafts">, title?: string }`
(also in `DesignView` / `MediaDetail`, so `social.get().mediaDetails[i].design`,
`media.designs`, MCP `get_post` / `get_designs` show it). Graphic and carousel
recipes are unchanged; `seedFromRecipe` (Create) refuses a reel recipe — reels
open in the reel editor.

### Tables

- `reelDrafts`: `{ title, recipe, listingIds, status, createdBy, userId?, note?, postId?, renderedUrl?, mediaId?, renderedAt?, createdAt, updatedAt }`, indexes `by_updated`, `by_status`.
- `reelAudio`: `{ kind: "voice" | "music", key, contentType, size, durationSec?, title?, listingId?, script?, voice?, words?, invalid?, userId?, createdAt }`, indexes `by_kind`, `by_key`.

### Push

When Claude creates a draft (or changes one that wasn't "ready"), admins get
"Reel draft ready to render", body "<title>: n clips, s s. Open it to check
and render.", link `https://studio.shemoqmedi.space/reels?draft=<id>`
(`studioReelUrl` in `lib/hosts.ts`), tag `reel-<id>`.

## 6. Studio URLs and the post sheet (Builder C: integration)

Files (Builder C owns them): `components/studio/reels/Reels.tsx` (the Reels
tab), `app/studio/reels/**` (routing, e.g. `page.tsx` reading `searchParams`),
`app/studio/screens/reels.css`, `components/studio/queue/MediaEditor.tsx`,
`components/studio/queue/mediaEdit.ts`, `components/studio/queue/PickSheet.tsx`
(and other `components/studio/queue/*` as needed), `docs/post-editing.md`
(a short "Reels" section), `docs/studio-contract.md` if it lists routes, tests
for these (`tests/postSheetMedia.test.ts` additions or a new
`tests/reelIntegration.test.ts`).

- `/reels` — the Reels tab: "New reel" (opens the editor empty), drafts
  (`reels.list`: title, cover, length, clips, status chip "Ready to render"
  for Claude's / "Rendered" / "Draft", note), recent reels (rendered
  drafts with their video), and the existing quick voiceover reel (the current
  `Reels` flow) kept as it is, as its own section or segment.
- `/reels?draft=<id>` — the editor with that draft (push links here).
- `/reels?draft=<id>&post=<postId>&item=<index>` — the same, opened from a
  post: after rendering, "Replace in post" = `social.update({ id: postId,
  media: post.media with item index → { kind: "video", url, role: "reel",
  networks: old.networks }, baseMedia: post.media.map(m => m.url) })` (confirm
  first when the post is approved / scheduled / failed: "This post goes back to
  Waiting. You approve it again after."), then `router.replace("/queue?post=<postId>")`.
- `/reels?new=1&post=<postId>` — a new reel for a post ("Use in a post" then
  appends / replaces as the post sheet chooses).
- Post sheet media editor: a video whose `mediaDetails[i].design?.kind === "reel"`
  shows "Edit reel": `reels.openFromMedia({ url, postId })` → push the URL
  above. A video without a recipe (a quick reel, a preview) may offer "Make a
  reel from this": `reels.create` with one clip (`listingVideo` / `upload-video`
  from its URL) → the same URL. Labels: `mediaEdit.ts` shows reels as "Reel".
- Builder B renders and reports; Builder C wires where the editor opens from
  and where the result goes. The editor component takes:

```tsx
type ReelEditorProps = {
  draftId: Id<"reelDrafts"> | null;           // null = new reel
  post?: { id: Id<"socialPosts">; item: number | null } | null; // opened from a post (item null = add)
  onClose: () => void;                          // back to /reels, or /queue?post=… when opened from a post
};
export function ReelEditor(props: ReelEditorProps): JSX.Element; // components/studio/reels/editor/ReelEditor.tsx
```

## 7. MCP (done)

Tools in `lib/mcp/server.ts` → `convex/mcp.ts` (token-checked admins):

- `create_reel_draft { title?, recipe, postId?, note? }` → DraftView. The
  recipe is loose (zod schema with every option optional); the server
  resolves `listingSlug` sources (listingVideo → the preview video URL with
  size and length; screenshot → `shot` n, 0 = cover), fills sizes from media
  rows, fills a voice from `narrationId` (URL, length, script, captions from
  the words or spread evenly), then `normalizeRecipe` + `validateRecipe`.
  Status ready, push to admins.
- `update_reel_draft { id, recipe?, title?, note?, postId? }` → DraftView (ready again).
- `get_reel_draft { id }`, `list_reel_drafts { status?, limit? }`.
- `attach_reel { postId, draftId, replaceIndex?, keepOthers?, networks? }` →
  the post (update_post rules). Refused unless the draft is rendered and
  unchanged since.
- `create_voiceover` now also returns `narrationId`.

INSTRUCTIONS explain the recipe, that Claude cannot render (Giorgi renders it
when he opens the draft), the 2.5 words/s narration budget, credits only after
a yes, and never approving or publishing.

## 8. File ownership

| Owner | Files |
| --- | --- |
| Contract + backend + MCP (done) | `docs/reel-editor.md`, `lib/reel/recipe.ts`, `lib/reel/timeline.ts`, `convex/lib/reel.ts`, `convex/reels.ts`, `convex/voiceover.ts`, `convex/lib/voiceover.ts`, `convex/schema.ts`, `convex/lib/design.ts`, `convex/lib/mediaEntry.ts`, `convex/mcp.ts`, `lib/mcp/server.ts`, `lib/hosts.ts`, `lib/studio/postEdit.ts` (reel guard only), `tests/reelRecipe.test.ts`, `tests/reels.test.ts` |
| A: engine / renderer | `lib/reel/compositor.ts`, `lib/reel/frames.ts`, `lib/reel/audio.ts`, `lib/reel/render.ts`, `lib/reel/probe.ts`, `lib/reel/fonts.ts`, `lib/reel/index.ts`, `components/studio/reels/PreviewPlayer.tsx`, `tests/reelEngine.test.ts` |
| B: editor UI | `components/studio/reels/editor/**`, `app/studio/screens/reel-editor.css`, `lib/studio/reelEditor.ts`, `lib/studio/reelRender.ts`, `tests/reelEditor.test.ts` |
| C: integration | `components/studio/reels/Reels.tsx`, `app/studio/reels/**`, `app/studio/screens/reels.css`, `components/studio/queue/**`, `docs/post-editing.md`, `docs/studio-contract.md`, `tests/reelIntegration.test.ts` (+ updates to existing queue tests only if they assert old markup) |

Shared, read-only for builders: everything in the first row, `components/studio/*`
primitives (`ui.tsx`, `Lightbox`, `TimeSheet`, `Droplet`, `Toasts`, `icons.tsx`
— add icons in your own files if needed), `lib/voiceoverMux.ts`,
`lib/videoUpload.ts`, `lib/imagekitUpload.ts`. Builders A and B only meet at
the exports in section 3 and the props in sections 3 and 6.
