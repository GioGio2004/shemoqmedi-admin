// The graphics engine's styles: every style draws every template in every
// format, and every carousel slide, without satori refusing the markup; the
// browser preview draws the same components as valid HTML; the shared glass
// layer and the one-encode finish produce what they say. No network: no
// screenshots are given, so nothing is fetched.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { FORMATS, FORMAT_IDS, STYLES, TEMPLATE_IDS, TEMPLATES, graphicsQuery, isStyle } from "../lib/graphics/spec";
import { loadStory, renderSingle, renderSlides } from "../lib/graphics/render";
import { GraphicPreview, browserShim, previewElement, previewFields, previewFontFaces } from "../lib/graphics/preview";
import { resolve } from "../lib/graphics/tree";
import { FONT_FILES, isFontFile } from "../lib/graphics/fonts";
import { buildBackdrop, finish, glassLayer, picture } from "../lib/graphics/imaging";
import { getPalette } from "../lib/palettes";
import type { StoryFacts } from "../lib/graphics/story";
import { createElement, type ReactElement } from "react";

const FIELDS: Record<string, string> = {
  tier: "SOTD",
  title: "Floema — Material, light and restraint",
  studio: "Bürocratik",
  date: "12 Nov 2026",
  url: "https://floema.com",
  tagline: "A furniture brand's site that feels like walking through the showroom, one material at a time.",
  headline: "Show us the site you’re proud of.",
  body: "Every submission is reviewed by hand and scored by an independent jury.",
  cta: "shemoqmedi.space/submit",
  quote: "Restraint everywhere: every transition earns its place.",
  juror: "Nino Beridze",
  role: "Creative director",
  site: "Floema",
  score: "8.4",
  index: "2 / 5",
};

const FACTS: StoryFacts = {
  title: "Floema",
  studio: "Bürocratik",
  url: "https://floema.com",
  tagline: "The nature of what endures.",
  kicker: "Site of the Day",
  date: "12 Nov 2026",
  tier: "SOTD",
  score: 8.9,
  pillars: { design: 9.2, usability: 8.4, creativity: 9.1, content: 8.6 },
  quote: "Material, light and restraint.",
  juror: "Nino",
  role: "Creative director",
  tech: ["GSAP", "WebGL", "Next.js"],
  categories: ["Portfolio"],
  link: "shemoqmedi.space/sites/floema",
  chips: ["The type"],
  notes: ["A wordmark set like furniture."],
  ctaHeadline: "See the whole site on Shemoqmedi.",
};

async function size(buf: Buffer) {
  const meta = await sharp(buf).metadata();
  return [meta.width, meta.height, meta.format];
}

describe("styles", () => {
  it("are listed once, with a label each", () => {
    expect(STYLES).toEqual(["glass", "swiss", "kinetic", "magazine", "bento"]);
    expect(isStyle("bento")).toBe(true);
    expect(isStyle("brutal")).toBe(false);
    expect(new URLSearchParams(graphicsQuery({ template: "award", format: "square", palette: "egypt", style: "swiss" })).get("style")).toBe("swiss");
    // Glass stays the default and keeps its URLs unchanged.
    expect(new URLSearchParams(graphicsQuery({ template: "award", format: "square", palette: "egypt", style: "glass" })).has("style")).toBe(false);
  });

  for (const style of STYLES) {
    it(`${style}: every template in every format renders a JPEG of the format's size`, async () => {
      for (const template of TEMPLATE_IDS) {
        for (const format of FORMAT_IDS) {
          const jpg = await renderSingle({ template, format, palette: "egypt", style, glass: "frost", fields: previewFields(template, FIELDS), screenshot: null, badgeUrl: null, output: "jpeg" });
          expect(await size(jpg), `${style}/${template}/${format}`).toEqual([FORMATS[format].width, FORMATS[format].height, "jpeg"]);
        }
      }
    }, 240_000);

    it(`${style}: every carousel slide renders, in one pass`, async () => {
      const story = await loadStory({ facts: FACTS, shots: [], mobile: null, badgeUrl: null, palette: "night", style, glass: "frost" });
      expect(story.plan).toEqual(["hook", "site", "detail", "jury", "credits", "cta"]);
      const slides = await renderSlides(story, "jpeg");
      expect(slides).toHaveLength(story.plan.length);
      for (const slide of slides) expect(await size(slide)).toEqual([1080, 1350, "jpeg"]);
    }, 120_000);
  }

  it("long and empty texts still render", async () => {
    const long = { ...FIELDS, title: "A".repeat(40) + " " + "word ".repeat(30), headline: "x", quote: "", juror: "", body: "", cta: "" };
    for (const style of STYLES) {
      for (const template of ["award", "call_jury", "jury_quote"] as const) {
        const png = await renderSingle({ template, format: "square", palette: "house", style, glass: "liquid", fields: previewFields(template, long), screenshot: null, badgeUrl: null, output: "png" });
        expect((await size(png))[2]).toBe("png");
      }
    }
  }, 120_000);
});

describe("the browser preview", () => {
  it("draws every style, template and format as plain HTML", () => {
    for (const style of STYLES) {
      for (const template of TEMPLATE_IDS) {
        for (const format of FORMAT_IDS) {
          const html = renderToStaticMarkup(createElement(GraphicPreview, { template, format, palette: "paper", style, fields: FIELDS, scale: 0.25 }));
          expect(html, `${style}/${template}/${format}`).toContain(`width:${FORMATS[format].width * 0.25}px`);
        }
      }
    }
  });

  it("rewrites satori's model into CSS", () => {
    const el = resolve(
      createElement("div", { style: { width: 10 } }, createElement("div", { style: { display: "block", lineClamp: 3 } }, "text"), createElement("img", { src: "x", width: 4, height: 4 })),
      browserShim,
    ) as ReactElement<{ style: Record<string, unknown>; children: ReactElement<{ style: Record<string, unknown> }>[] }>;
    expect(el.props.style).toMatchObject({ display: "flex", position: "relative", boxSizing: "border-box", flexShrink: 0 });
    const [clamped, img] = el.props.children;
    expect(clamped.props.style).toMatchObject({ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" });
    expect(clamped.props.style.lineClamp).toBeUndefined();
    expect(img.props.style).toMatchObject({ display: "block" });
  });

  it("uses the assets' palette for auto and blurs a stand-in until the glass backdrop arrives", () => {
    const loading = renderToStaticMarkup(previewElement({ template: "award", format: "square", palette: "auto", fields: FIELDS, shotUrl: "https://ik.imagekit.io/x/a.jpg" }));
    expect(loading).toContain("blur(36px)");
    const ready = renderToStaticMarkup(
      previewElement({ template: "award", format: "square", palette: "auto", fields: FIELDS, assets: { palette: { base: "#123456", surface: "#222222", accent: "#FF0000" }, light: false, back: "data:image/jpeg;base64,AA", frost: "data:image/jpeg;base64,BB", shot: "" } }),
    );
    expect(ready).not.toContain("blur(36px)");
    expect(ready).toContain("#123456");
    expect(ready).toContain("data:image/jpeg;base64,BB");
  });

  it("fills empty fields with the template's defaults", () => {
    expect(previewFields("call_jury", { headline: "  " }).headline).toBe(TEMPLATES.call_jury.defaults.headline);
    expect(previewFields("award", { title: " Floema " }).title).toBe("Floema");
  });

  it("loads the same faces the server draws with", () => {
    expect(FONT_FILES.map((f) => f.family)).toContain("Instrument Serif");
    expect(previewFontFaces.match(/@font-face/g)).toHaveLength(FONT_FILES.length);
    expect(previewFontFaces).toContain("/api/graphics/fonts/instrument-serif-latin-400-italic.woff");
    expect(isFontFile("inter-latin-700-normal.woff")).toBe(true);
    expect(isFontFile("../.env.local")).toBe(false);
  });
});

describe("the shared glass layer", () => {
  it("lays shadows, frost and rims under the panels in one raster, and finishes in one encode", async () => {
    const pic = (await picture(await sharp({ create: { width: 300, height: 200, channels: 3, background: "#3355AA" } }).png().toBuffer()))!;
    const bd = await buildBackdrop({ width: 600, height: 400, palette: getPalette("egypt"), layers: [{ pic, from: 0, to: 1 }], veil: 0.5, blur: 26, frostBlur: 120, frostLight: 0.3 });
    // Same options: the cached backdrop, not a second build.
    expect(await buildBackdrop({ width: 600, height: 400, palette: getPalette("egypt"), layers: [{ pic, from: 0, to: 1 }], veil: 0.5, blur: 26, frostBlur: 120, frostLight: 0.3 })).toBe(bd);
    const rim = { angle: 160, stops: [["rgba(255,255,255,0.9)", 0], ["rgba(255,255,255,0.4)", 1]] as [string, number][] };
    const panel = { x: 100, y: 100, w: 200, h: 120, radius: 30, edge: 1, rim, shadows: [{ y: 20, blur: 40, colour: "rgba(0,0,0,0.3)" }] };
    const bare = await glassLayer(bd, { left: 0, top: 0, width: 600, height: 400 }, []);
    const layered = await glassLayer(bd, { left: 0, top: 0, width: 600, height: 400 }, [panel]);
    expect([layered.width, layered.height, layered.channels, layered.data.length]).toEqual([600, 400, 3, 600 * 400 * 3]);
    const at = (r: typeof bare, x: number, y: number) => r.data[(y * 600 + x) * 3];
    // Inside the panel the frost (lighter) shows; far outside it, the plain backdrop.
    expect(at(layered, 200, 160)).toBeGreaterThan(at(bare, 200, 160));
    expect(at(layered, 5, 395)).toBe(at(bare, 5, 395));
    const overlay = await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const jpg = await finish(overlay, "jpeg", { under: layered });
    expect(await size(jpg)).toEqual([600, 400, "jpeg"]);
  });
});
