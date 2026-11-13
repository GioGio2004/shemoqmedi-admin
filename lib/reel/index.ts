// The reel engine in one import: the recipe and timeline (shared, read-only),
// the compositor, frame providers, sound mix, render and probes.
// Contract: docs/reel-editor.md section 3.

export * from "./recipe";
export * from "./timeline";
export { drawFrame, releaseCompositor, safeInsets, textSpec, captionSpec, layoutBlock, wrapWords, blockTop, captionReserve, lookMatrix, type Ctx2D, type BlockSpec, type BlockLayout } from "./compositor";
export {
  createPreviewFrames,
  createRenderFrames,
  loadBitmap,
  neededWidth,
  sizedImageUrl,
  PreviewFrames,
  ReelAbortError,
  ReelSourceError,
  type FrameImage,
  type FrameProvider,
  type PreviewFramesOptions,
} from "./frames";
export { audioKey, decodeSound, mixAudio, mixPlan, planAudio, SAMPLE_RATE, type AudioPlan, type Pcm, type PlannedTrack } from "./audio";
export {
  MAX_RENDER_BYTES,
  NO_AAC,
  NO_VIDEO_ENCODER,
  RenderError,
  overallProgress,
  render,
  renderSupport,
  uploadRender,
  videoBitrate,
  type RenderErrorCode,
  type RenderProgress,
  type RenderStage,
  type RenderSupport,
} from "./render";
export { frameAtSource, looksLikeImage, probeSource, releaseProbes, sourceThumbnails, type ProbeResult } from "./probe";
export { ensureReelFonts, reelFont, REEL_FONT_FAMILY, REEL_FONT_STACK } from "./fonts";
