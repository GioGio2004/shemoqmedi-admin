import type { ReactElement } from "react";
import { getPalette, isDark, type Palette } from "@/lib/palettes";
import { FORMATS, TEMPLATES, type FormatId, type Style, type TemplateId } from "./spec";
import type { GlassStyle, Scene } from "./glass";
import { renderTemplate } from "./templates";
import { FLAT_STYLES, themeOf } from "./styles";
import { resolve, type HostVisitor } from "./tree";

// The Studio's instant preview: the same template components the server
// renders with satori, drawn by the browser inside a scaled box. Nothing
// here touches the network or node (no sharp): it is pure markup, so a
// change of text, palette or style redraws in a frame. The final JPEG still
// comes from the server ("Render final").
//
// Glass needs its backdrop and frost (sharp work), fetched once per
// screenshot + palette + glass + format from GET /api/graphics/assets and
// passed in as `assets`. Until they arrive a CSS-blurred copy of the
// screenshot stands in.
//
// Satori is not a browser, so each element is rewritten on the way (shim):
//   every div is a flex box and a containing block (yoga's model),
//   boxes with a fixed size never shrink (yoga's flexShrink is 0),
//   lineClamp becomes -webkit-line-clamp,
//   outlined text paints its stroke under the fill, as satori does.
// The faces come from previewFontFaces (lib/graphics/fonts.ts): put it in a
// <style> once on the page.

export { previewFontFaces } from "./fonts";

/** What /api/graphics/assets returns, plus an optional badge image. All optional: the preview draws without them. */
export type PreviewAssets = {
  palette?: Pick<Palette, "base" | "surface" | "accent">;
  light?: boolean;
  back?: string;
  frost?: string;
  shot?: string;
  badge?: string;
};

export type GraphicPreviewProps = {
  template: TemplateId;
  format: FormatId;
  /** A palette id, or "auto" (taken from assets.palette once it has loaded). */
  palette: string;
  style?: Style;
  glass?: GlassStyle;
  fields?: Record<string, string | undefined>;
  assets?: PreviewAssets | null;
  /** Fallback screenshot URL while assets load (also the blurred stand-in for glass). */
  shotUrl?: string | null;
  /** Rendered size = format size × scale. */
  scale?: number;
  className?: string;
};

/** The template's fields with its defaults filled in, as the route does (render.ts fieldsFrom). */
export function previewFields(template: TemplateId, fields: Record<string, string | undefined> = {}) {
  const spec = TEMPLATES[template];
  const out: Record<string, string> = { ...spec.defaults };
  for (const [key, value] of Object.entries(fields)) {
    const v = value?.trim();
    if (v) out[key] = v.slice(0, 600);
  }
  return out;
}

const FIXED_IN_FLEX = ["width", "height", "flexBasis"] as const;

/** Satori's layout model in CSS terms, one host element at a time. */
export const browserShim: HostVisitor = (type, props) => {
  const style: Record<string, unknown> = { ...(props.style ?? {}) };
  if (type === "img" || type === "svg") {
    style.display ??= "block";
    style.flexShrink ??= 0;
    return { ...props, style };
  }
  if (style.lineClamp !== undefined) {
    style.display = "-webkit-box";
    style.WebkitLineClamp = style.lineClamp;
    style.WebkitBoxOrient = "vertical";
    style.overflow = "hidden";
    delete style.lineClamp;
  }
  style.display ??= "flex";
  style.position ??= "relative";
  style.boxSizing = "border-box";
  // Text-only boxes may shrink (so they wrap); boxes with a size never do, like in yoga.
  if (FIXED_IN_FLEX.some((k) => style[k] !== undefined)) style.flexShrink ??= 0;
  if (style.WebkitTextStroke !== undefined) style.paintOrder = "stroke fill";
  return { ...props, style };
};

/** Blurs the stand-in backdrop (the screenshot itself) until the real one has loaded. */
function standInShim(standIn: string | null): HostVisitor {
  return (type, props) => {
    const next = browserShim(type, props);
    if (type === "img" && standIn && (props as { src?: string }).src === standIn) {
      return { ...next, style: { ...next.style, objectFit: "cover", filter: "blur(36px) saturate(1.3)", transform: "scale(1.15)", opacity: 0.55 } };
    }
    return next;
  };
}

function paletteOf(id: string, assets: PreviewAssets | null | undefined): Palette {
  if (id === "auto") {
    const p = assets?.palette ?? getPalette("night");
    return { id: "auto", name: "Auto", base: p.base, surface: p.surface, accent: p.accent };
  }
  return getPalette(id);
}

/** The graphic as browser markup, at full size (unscaled). */
export function previewElement({ template, format, palette: paletteId, style = "glass", glass = "frost", fields, assets, shotUrl }: GraphicPreviewProps): ReactElement {
  const palette = paletteOf(paletteId, assets);
  const f = previewFields(template, fields);
  const shot = assets?.shot || shotUrl || null;
  const badge = assets?.badge ?? null;
  const { width, height } = FORMATS[format];
  if (style === "glass") {
    const back = assets?.back || shot;
    const scene: Scene = {
      palette,
      light: assets?.light ?? !isDark(palette.base),
      frost: assets?.frost || null,
      view: { x: 0, y: 0, w: width, h: height },
      style: glass,
      layer: "panel",
    };
    const showsShot = template === "award" || template === "new_listing" || template === "screenshot";
    const element = renderTemplate({ template, format, scene, fields: f, assets: { back, shot: showsShot ? shot : null, badge } });
    return resolve(element, standInShim(assets?.back ? null : back)) as ReactElement;
  }
  const element = FLAT_STYLES[style].single({ template, format, fields: f, theme: themeOf(palette), shot, badge });
  return resolve(element, browserShim) as ReactElement;
}

/**
 * One graphic, drawn in the browser at `scale` (default: 0.3). Pure: give it
 * new props and it redraws; no effects, no fetching.
 */
export function GraphicPreview(props: GraphicPreviewProps) {
  const scale = props.scale ?? 0.3;
  const { width, height } = FORMATS[props.format];
  return (
    <div className={props.className} style={{ position: "relative", width: width * scale, height: height * scale, overflow: "hidden", flexShrink: 0 }}>
      <div style={{ position: "absolute", left: 0, top: 0, width, height, transform: `scale(${scale})`, transformOrigin: "0 0" }}>{previewElement(props)}</div>
    </div>
  );
}
