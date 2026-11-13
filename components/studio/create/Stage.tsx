"use client";

import { memo, useDeferredValue, useMemo } from "react";
import { GraphicPreview, type GraphicPreviewProps, type PreviewAssets } from "@/lib/graphics/preview";
import { FORMATS, STYLES, STYLE_INFO, type FormatId, type Style, type TemplateId } from "@/lib/graphics/spec";
import { getPalette } from "@/lib/palettes";
import { PALETTE_CHOICES, assetsUrl, miniFetchesAssets, previewShotUrl, type GlassId, type PaletteChoice } from "@/lib/studio/create";
import { useWidth } from "../hooks";
import { PickedMark } from "./PickedMark";
import { useAssets } from "./useAssets";

// The instant preview: the graphic drawn by the browser from the same
// template components the server renders (lib/graphics/preview), so every
// keystroke, palette or style shows in the next frame. The palette strip
// and the style cards draw the same design small, once per choice.

/** Everything a preview depends on. */
export type Look = {
  template: TemplateId;
  format: FormatId;
  palette: PaletteChoice;
  style: Style;
  glass: GlassId;
  fields: Record<string, string>;
  shot: string | null;
};

function props(look: Look, assets: PreviewAssets | null, scale: number): GraphicPreviewProps {
  return {
    template: look.template,
    format: look.format,
    palette: look.palette,
    style: look.style,
    glass: look.glass,
    fields: look.fields,
    assets,
    // The screenshot by URL (one download for every palette and style), not inside each palette's assets.
    shotUrl: previewShotUrl(look.shot),
    scale,
  };
}

/**
 * The big preview, sized by its box (no layout shift: the box's ratio is set
 * by CSS before anything draws). The graphic sits flush on its own corners;
 * on a phone the stage pins under the top bar on glass and shrinks to a
 * thumbnail while a field of its step has focus.
 */
export function PreviewStage({ look, sticky, note }: { look: Look; sticky?: boolean; note?: string }) {
  const url = assetsUrl(look);
  const assets = useAssets(url);
  const [ref, width] = useWidth<HTMLDivElement>();
  const { width: fw, height: fh } = FORMATS[look.format];
  const waiting = !!url && !assets;
  return (
    <div className={`st-stage st-create-stage${sticky ? " st-stage-sticky" : ""}`}>
      <div ref={ref} className="st-stage-box" style={{ ["--ar" as string]: `${fw} / ${fh}` }} aria-label="Preview" role="img">
        {width > 0 && <GraphicPreview {...props(look, assets, width / fw)} />}
      </div>
      <div className="st-stage-meta">
        <span>{note ?? `${FORMATS[look.format].label} · ${fw}×${fh}`}</span>
        <span className="st-create-live" aria-live="polite">
          {waiting ? <span className="st-spin" aria-hidden="true" /> : <span className="st-dot" data-tone="live" aria-hidden="true" />}
          {waiting ? (look.style === "glass" ? "Preparing the glass…" : "Reading colours…") : "Live"}
        </span>
      </div>
    </div>
  );
}

/**
 * One small copy of the design (memoized: it redraws only when its own look
 * changes). `fetchAssets: false` (the palette strip in glass) only shows
 * assets already loaded, so the strip doesn't build a backdrop per palette.
 */
const Mini = memo(function Mini({ look, width, fetchAssets = true }: { look: Look; width: number; fetchAssets?: boolean }) {
  const assets = useAssets(assetsUrl(look), { fetch: fetchAssets });
  const { width: fw, height: fh } = FORMATS[look.format];
  const scale = width / fw;
  return (
    <span className="st-swatch-box st-create-mini" style={{ width, height: Math.round(fh * scale) }}>
      <GraphicPreview {...props(look, assets, scale)} />
    </span>
  );
});

/**
 * The same design in every palette (and auto); a tap picks one. Drawn at low
 * priority so typing stays instant. In glass, a palette shows its real
 * backdrop once it has been previewed; until then the blurred stand-in.
 */
export function PaletteStrip({ look, onPick }: { look: Look; onPick: (p: PaletteChoice) => void }) {
  const deferred = useDeferredValue(look);
  // One stable look per palette, so each small copy redraws only when the design does.
  const looks = useMemo(() => PALETTE_CHOICES.map((p) => ({ ...deferred, palette: p })), [deferred]);
  const width = FORMATS[look.format].width > FORMATS[look.format].height ? 104 : 70;
  return (
    <div className="st-create-strip" role="group" aria-label="Palette">
      {PALETTE_CHOICES.map((p, i) => {
        const palette = p === "auto" ? null : getPalette(p);
        const on = look.palette === p;
        return (
          <button
            key={p}
            type="button"
            className="st-create-tile st-create-swatch st-glass lq"
            aria-pressed={on}
            onClick={() => onPick(p)}
            aria-label={palette ? palette.name : "Auto (from the screenshot)"}
            style={{ width }}
          >
            <Mini look={looks[i]} width={width} fetchAssets={miniFetchesAssets(looks[i])} />
            {palette ? (
              <span className="st-create-bar" aria-hidden="true">
                <span style={{ flex: 6, background: palette.base }} />
                <span style={{ flex: 3, background: palette.surface }} />
                <span style={{ flex: 1, background: palette.accent }} />
              </span>
            ) : (
              <span className="st-create-bar is-auto" aria-hidden="true" />
            )}
            <span className="st-create-tile-label">{palette ? palette.name : "Auto"}</span>
            {on && <PickedMark />}
          </button>
        );
      })}
    </div>
  );
}

/** The five styles, each showing the current design in it. */
export function StylePicker({ look, onPick }: { look: Look; onPick: (s: Style) => void }) {
  const deferred = useDeferredValue(look);
  const looks = useMemo(() => STYLES.map((s) => ({ ...deferred, style: s })), [deferred]);
  const wide = FORMATS[look.format].width > FORMATS[look.format].height;
  const width = wide ? 140 : look.format === "story" ? 88 : 116;
  return (
    <div className="st-create-strip st-create-styles" role="group" aria-label="Style">
      {STYLES.map((s, i) => {
        const on = look.style === s;
        return (
          <button key={s} type="button" className="st-create-tile st-glass lq" aria-pressed={on} onClick={() => onPick(s)} title={STYLE_INFO[s].description} style={{ width }}>
            <Mini look={looks[i]} width={width} />
            <span className="st-create-tile-label">{STYLE_INFO[s].label}</span>
            {on && <PickedMark />}
          </button>
        );
      })}
    </div>
  );
}
