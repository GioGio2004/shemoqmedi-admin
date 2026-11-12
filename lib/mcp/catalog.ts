// What the graphics renderer offers, for the MCP tools list_templates,
// list_palettes and list_styles and the descriptions of render_graphic / render_carousel.
// Everything is read from lib/graphics/spec.ts and lib/palettes.ts, so the
// connector can't drift from what the renderer accepts.

import { FORMATS, FORMAT_IDS, STYLES, STYLE_INFO, TEMPLATES, TEMPLATE_IDS, type FormatId, type Style } from "@/lib/graphics/spec";
import { MEDIA_ROLES, type MediaRole } from "@/lib/mediaRoles";
import { PALETTES, PALETTE_IDS } from "@/lib/palettes";

/** Instagram feed images must be between 4:5 and 1.91:1 (convex/lib/socialApi.ts). */
const IG_MIN_RATIO = 0.8;
const IG_MAX_RATIO = 1.91;

/** How a format is used on Instagram: in the feed as it is, padded with white for the feed, or as a story. */
function instagramUse(id: FormatId): "feed" | "padded" | "story" {
  const { width, height } = FORMATS[id];
  if (id === "story" || id === "reel_cover") return "story";
  const ratio = width / height;
  return ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO ? "feed" : "padded";
}

export function templateCatalog() {
  return {
    templates: TEMPLATE_IDS.map((id) => {
      const spec = TEMPLATES[id];
      return {
        id,
        label: spec.label,
        fields: spec.fields.map((f) => ({
          key: f.key,
          label: f.label,
          ...("long" in f && f.long ? { long: true } : {}),
          ...("options" in f && f.options ? { options: [...f.options] } : {}),
          ...("placeholder" in f && f.placeholder ? { placeholder: f.placeholder } : {}),
        })),
        images: [...spec.images],
        defaults: { ...spec.defaults },
      };
    }),
    formats: FORMAT_IDS.map((id) => ({ id, label: FORMATS[id].label, width: FORMATS[id].width, height: FORMATS[id].height, instagram: instagramUse(id) })),
  };
}

export function paletteCatalog() {
  return {
    palettes: PALETTES.map((p) => ({ id: p.id, name: p.name, base: p.base, surface: p.surface, accent: p.accent })),
    auto: "auto: tinted from the screenshot (base, surface and accent picked from its colours)",
    roles: "base 60% (background), surface 30% (large blocks: the screenshot panel, text bands), accent 10% (small marks: tier chip, call to action, rules)",
  };
}

export function styleCatalog() {
  return {
    styles: STYLES.map((id) => ({
      id,
      label: STYLE_INFO[id].label,
      description: STYLE_INFO[id].description,
      // Only glass composes a blurred backdrop of the screenshot (sharp); the others are flat.
      speed: id === "glass" ? "slower (blurred backdrop)" : "fast (flat)",
    })),
    default: "glass" satisfies Style,
    note: "Every style renders every template, format and the carousel, and keeps the palette's 60/30/10 roles.",
  };
}

/** The style argument's description, from STYLES. */
export const STYLE_DESCRIPTION = `Visual style: ${STYLES.join(", ")} (default glass, the frosted look). The flat styles render fast. list_styles describes each.`;

/** The palette argument's description, from PALETTE_IDS. */
export const PALETTE_DESCRIPTION = `Palette id: ${PALETTE_IDS.join(", ")}, or "auto" (tinted from the screenshot). list_palettes shows their colours.`;

/** z.enum needs a non-empty tuple; the spec's id lists always have entries. */
export const TEMPLATE_ENUM = TEMPLATE_IDS as [(typeof TEMPLATE_IDS)[number], ...(typeof TEMPLATE_IDS)[number][]];
export const FORMAT_ENUM = FORMAT_IDS as [FormatId, ...FormatId[]];
export const STYLE_ENUM = STYLES as unknown as [Style, ...Style[]];
export const MEDIA_ROLE_ENUM = MEDIA_ROLES as unknown as [MediaRole, ...MediaRole[]];
