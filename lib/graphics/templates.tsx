/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { ReactNode } from "react";
import { FORMATS, TIERS, type FormatId, type TemplateId, type Tier } from "./spec";
import {
  wrapLines,
  Arrow,
  BrowserGlass,
  Display,
  Glass,
  Label,
  QuoteMark,
  ScoreTile,
  Seal,
  Wordmark,
  col,
  fit,
  host,
  ink,
  pillWidth,
  row,
  soft,
  type Rect,
  type Scene,
} from "./glass";

// Single-image social graphics in the glass language (see glass.tsx): a
// blurred, palette-tinted backdrop of the site, glass panels whose
// coordinates are fixed per format (so the frost lines up), Inter display
// type. One layout per template and shape: wide (link 1200×627), portrait
// (1080×1350), square (1080×1080), tall (story and reel cover, 1080×1920;
// a reel cover keeps everything inside the 3:4 crop the profile grid shows).

export type SingleAssets = {
  back: string | null;
  /** The screenshot, sharp, for browser windows. */
  shot: string | null;
  badge: string | null;
};

export type RenderInput = {
  template: TemplateId;
  format: FormatId;
  scene: Scene;
  fields: Record<string, string>;
  assets: SingleAssets;
};

type Shape = "wide" | "portrait" | "square" | "tall";

type Frame = { W: number; H: number; M: number; shape: Shape };

function frameOf(format: FormatId): Frame {
  const { width: W, height: H } = FORMATS[format];
  const shape: Shape = W / H > 1.3 ? "wide" : H / W > 1.6 ? "tall" : H > W ? "portrait" : "square";
  return { W, H, M: shape === "wide" ? 56 : 88, shape };
}

function At({ x, y, w, children }: { x: number; y: number; w?: number; children: ReactNode }) {
  return <div style={{ ...col, position: "absolute", left: x, top: y, ...(w ? { width: w } : {}) }}>{children}</div>;
}

/** A text area from `top` to `bottom`, its content sitting on the bottom edge. */
function Area({ x, top, bottom, w, align = "flex-end", children }: { x: number; top: number; bottom: number; w: number; align?: "flex-end" | "center"; children: ReactNode }) {
  return <div style={{ ...col, position: "absolute", left: x, top, width: w, height: bottom - top, justifyContent: align }}>{children}</div>;
}

/** Title size for a block of `areaH` px that also holds the label, studio and tagline. */
function titleSize(title: string, width: number, areaH: number, max: number, studio: boolean, tagline: string, taglineSize: number, studioSize = 36) {
  const tagLines = tagline ? Math.min(3, wrapLines(tagline, width, taglineSize, 0.5)) : 0;
  const rest = 22 + 30 + (studio ? 26 + studioSize * 1.2 : 0) + (tagLines ? 22 + tagLines * taglineSize * 1.36 : 0);
  return fit(title, width, 4, max, 40, areaH - rest);
}

function TitleBlock({
  s,
  kicker,
  title,
  size,
  studio,
  tagline,
  taglineSize = 28,
  studioSize = 36,
}: {
  s: Scene;
  kicker: string;
  title: string;
  size: number;
  studio?: string;
  tagline?: string;
  taglineSize?: number;
  studioSize?: number;
}) {
  // A column, not a fragment: satori lays fragments out as a row.
  return (
    <div style={{ ...col }}>
      <Label s={s} dot size={Math.max(15, Math.round(studioSize * 0.55))}>
        {kicker}
      </Label>
      <div style={{ display: "flex", marginTop: 30 }}>
        <Display s={s} size={size}>
          {title}
        </Display>
      </div>
      {studio ? (
        <div style={{ display: "flex", marginTop: 26, fontSize: studioSize, fontWeight: 500, letterSpacing: -0.6, color: soft(s, 0.72) }}>
          by {studio}
        </div>
      ) : null}
      {tagline ? (
        <div style={{ display: "block", marginTop: 22, fontSize: taglineSize, lineHeight: 1.36, color: soft(s, 0.75), lineClamp: 3 }}>{tagline}</div>
      ) : null}
    </div>
  );
}

function Header({ s, fr, right }: { s: Scene; fr: Frame; right?: string }) {
  const y = fr.shape === "tall" ? 300 : fr.M;
  const size = fr.shape === "wide" ? 15 : 19;
  return (
    <>
      <At x={fr.M} y={y}>
        <Wordmark s={s} size={size} />
      </At>
      {right ? (
        <At x={fr.W / 2} y={y} w={fr.W / 2 - fr.M}>
          <div style={{ ...row, justifyContent: "flex-end" }}>
            <Label s={s} size={size}>
              {right}
            </Label>
          </div>
        </At>
      ) : null}
    </>
  );
}

function Canvas({ s, fr, back, children }: { s: Scene; fr: Frame; back: string | null; children: ReactNode }) {
  return (
    // A shared-layer render is transparent: sharp lays it over the backdrop (render.ts).
    <div style={{ display: "flex", position: "relative", width: fr.W, height: fr.H, overflow: "hidden", fontFamily: "Inter", background: s.layer === "shared" ? "transparent" : s.palette.base }}>
      {back ? <img src={back} width={fr.W} height={fr.H} style={{ position: "absolute", left: 0, top: 0 }} /> : null}
      {children}
    </div>
  );
}

/** Where the browser window goes, per shape. */
function browserRect(fr: Frame): Rect {
  const w = fr.W - fr.M * 2;
  switch (fr.shape) {
    case "wide":
      return { x: 600, y: 72, w: 780, h: 490 };
    case "portrait":
      return { x: fr.M, y: 724, w, h: 560 };
    case "square":
      return { x: fr.M, y: 590, w, h: 440 };
    case "tall":
      return { x: fr.M, y: 1100, w, h: 570 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Award and new listing
// ─────────────────────────────────────────────────────────────────────────────

function SiteCard({ s, fr, f, a, award }: { s: Scene; fr: Frame; f: Record<string, string>; a: SingleAssets; award: boolean }) {
  const tier = (f.tier in TIERS ? f.tier : "SOTD") as Tier;
  const kicker = award ? TIERS[tier] : f.kicker || "New on Shemoqmedi";
  const tagline = award ? "" : f.tagline;
  const b = browserRect(fr);
  const browser = <BrowserGlass s={s} rect={b} src={a.shot} url={f.url} radius={fr.shape === "wide" ? 26 : 34} />;

  if (fr.shape === "wide") {
    const width = 500;
    const size = titleSize(f.title, width, (award ? 430 : 560) - 110, 70, true, tagline, 20, 24);
    const seal = 168;
    return (
      <>
        {browser}
        <At x={fr.M} y={fr.M}>
          <Wordmark s={s} size={15} />
        </At>
        <Area x={fr.M} top={110} bottom={award ? 430 : 560} w={width} align="center">
          <TitleBlock s={s} kicker={kicker} title={f.title} size={size} studio={f.studio} tagline={tagline} taglineSize={20} studioSize={24} />
        </Area>
        {award ? <Seal s={s} rect={{ x: b.x - seal / 2 + 10, y: fr.H - seal - 36, w: seal, h: seal }} badge={a.badge} tier={tier} /> : null}
        {f.date ? (
          <At x={fr.M} y={fr.H - fr.M - 18}>
            <Label s={s} size={15}>
              {f.date}
            </Label>
          </At>
        ) : null}
      </>
    );
  }

  const seal = fr.shape === "square" ? 200 : 236;
  // The seal sits on the browser's corner; only portrait and square titles share its column.
  const width = fr.W - fr.M * 2 - (award && fr.shape !== "tall" ? seal * 0.55 : 0);
  const max = fr.shape === "tall" ? 150 : fr.shape === "portrait" ? 132 : 112;
  const taglineSize = fr.shape === "square" ? 26 : 30;
  const bottom = b.y - (award ? 110 : 60);
  const top = fr.shape === "tall" ? 360 : 160;
  const size = titleSize(f.title, width, bottom - top, f.title.length <= 12 ? max * 1.3 : max, true, tagline, taglineSize);
  return (
    <>
      <Header s={s} fr={fr} right={award ? f.date : undefined} />
      <Area x={fr.M} top={top} bottom={bottom} w={width}>
        <TitleBlock s={s} kicker={kicker} title={f.title} size={size} studio={f.studio} tagline={tagline} taglineSize={taglineSize} />
      </Area>
      {browser}
      {award ? <Seal s={s} rect={{ x: fr.W - fr.M - seal + 24, y: b.y - seal * 0.62, w: seal, h: seal }} badge={a.badge} tier={tier} /> : null}
      {fr.shape === "tall" ? (
        <At x={fr.M} y={b.y + b.h + 64} w={fr.W - fr.M * 2}>
          <div style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
            <Label s={s}>{f.url ? host(f.url) : "shemoqmedi.space"}</Label>
            <Label s={s}>shemoqmedi.space</Label>
          </div>
        </At>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot slide
// ─────────────────────────────────────────────────────────────────────────────

function ScreenshotSlide({ s, fr, f, a }: { s: Scene; fr: Frame; f: Record<string, string>; a: SingleAssets }) {
  const caption = (size: number) => (
    <div style={{ ...col }}>
      <Display s={s} size={size}>
        {f.title || host(f.url || "shemoqmedi.space")}
      </Display>
      {f.studio ? <div style={{ display: "flex", marginTop: 16, fontSize: size * 0.48, fontWeight: 500, color: soft(s, 0.7) }}>by {f.studio}</div> : null}
    </div>
  );
  if (fr.shape === "wide") {
    const b = { x: fr.M, y: 72, w: 760, h: 483 };
    return (
      <>
        <BrowserGlass s={s} rect={b} src={a.shot} url={f.url} radius={26} />
        <At x={870} y={fr.M}>
          <Wordmark s={s} size={14} />
        </At>
        <At x={870} y={250} w={290}>
          {caption(fit(f.title || "x", 290, 3, 52, 26))}
        </At>
      </>
    );
  }
  const w = fr.W - fr.M * 2;
  const h = Math.round(w / 1.6);
  const y = fr.shape === "tall" ? 620 : fr.shape === "portrait" ? 360 : 230;
  return (
    <>
      <Header s={s} fr={fr} right={f.index} />
      <BrowserGlass s={s} rect={{ x: fr.M, y, w, h }} src={a.shot} url={f.url} />
      <At x={fr.M} y={y + h + (fr.shape === "square" ? 56 : 80)} w={w}>
        {caption(fit(f.title || "x", w, 1, fr.shape === "square" ? 64 : 76, 36))}
      </At>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Jury quote
// ─────────────────────────────────────────────────────────────────────────────

function JuryQuote({ s, fr, f }: { s: Scene; fr: Frame; f: Record<string, string> }) {
  const quote = f.quote.replace(/^["“]|["”]$/g, "");
  const score = Number(f.score);
  const hasScore = f.score !== undefined && f.score !== "" && Number.isFinite(score);
  const wide = fr.shape === "wide";
  const card: Rect = wide
    ? { x: fr.M, y: fr.M, w: 760, h: fr.H - fr.M * 2 }
    : fr.shape === "tall"
      ? { x: fr.M, y: 400, w: fr.W - fr.M * 2, h: 860 }
      : fr.shape === "portrait"
        ? { x: fr.M, y: 190, w: fr.W - fr.M * 2, h: 780 }
        : { x: fr.M, y: 170, w: fr.W - fr.M * 2, h: 600 };
  const pad = wide ? 44 : 56;
  const textW = card.w - pad * 2;
  const qSize = fit(quote, textW, wide ? 5 : fr.shape === "square" ? 5 : 7, wide ? 40 : 64, 24);
  const tile = wide ? 170 : 210;
  const siteBlock = (
    <div style={{ ...col }}>
      <Label s={s} size={wide ? 14 : 18}>
        From the jury, on
      </Label>
      <div style={{ display: "flex", marginTop: 14 }}>
        <Display s={s} size={fit(f.site || "Shemoqmedi", wide ? 300 : 600, 2, wide ? 44 : 64, 28)}>
          {f.site || "Shemoqmedi"}
        </Display>
      </div>
    </div>
  );
  return (
    <>
      {wide ? null : <Header s={s} fr={fr} right="The jury" />}
      <Glass s={s} rect={card} pad={pad} inner={{ justifyContent: "space-between" }}>
        <div style={{ ...col }}>
          <QuoteMark size={wide ? 40 : 56} color={s.palette.accent} />
          <div style={{ display: "flex", marginTop: wide ? 18 : 28, fontSize: qSize, fontWeight: 500, lineHeight: 1.16, letterSpacing: -qSize * 0.02, color: ink(s) }}>
            {quote}
          </div>
        </div>
        <div style={{ ...row, alignItems: "center" }}>
          <div style={{ width: 40, height: 2, background: soft(s, 0.4), marginRight: 20 }} />
          <div style={{ ...col }}>
            <span style={{ fontSize: wide ? 20 : 26, fontWeight: 600, color: ink(s) }}>{f.juror}</span>
            {f.role ? <span style={{ fontSize: wide ? 16 : 21, color: soft(s, 0.65), marginTop: 4 }}>{f.role}</span> : null}
          </div>
        </div>
      </Glass>
      {wide ? (
        <>
          <At x={860} y={fr.M}>
            <Wordmark s={s} size={14} />
          </At>
          <At x={860} y={150} w={290}>
            {siteBlock}
          </At>
          {hasScore ? <ScoreTile s={s} rect={{ x: 860, y: fr.H - fr.M - tile, w: tile, h: tile }} value={score.toFixed(1)} label="Jury score" /> : null}
        </>
      ) : (
        <>
          <At x={fr.M} y={card.y + card.h + 60} w={hasScore ? 600 : fr.W - fr.M * 2}>
            {siteBlock}
          </At>
          {hasScore ? (
            <ScoreTile s={s} rect={{ x: fr.W - fr.M - tile, y: card.y + card.h + 50, w: tile, h: tile }} value={score.toFixed(1)} label="Jury score" />
          ) : null}
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calls and announcements
// ─────────────────────────────────────────────────────────────────────────────

/** "https://www.shemoqmedi.space/submit/" → "shemoqmedi.space/submit". */
function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function Call({ s, fr, f }: { s: Scene; fr: Frame; f: Record<string, string> }) {
  const cta = f.cta ? shortUrl(f.cta) : "";
  const ctaPill = (rect: Rect, size: number) => (
    <Glass
      s={s}
      rect={rect}
      radius={rect.h / 2}
      inner={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: `0 ${size * 1.2}px 0 ${size * 1.4}px` }}
    >
      <div style={{ display: "flex", fontSize: size, fontWeight: 600, letterSpacing: -size * 0.01, color: ink(s) }}>{cta}</div>
      <Arrow size={size * 1.15} color={ink(s)} />
    </Glass>
  );

  if (fr.shape === "wide") {
    const leftW = 600;
    return (
      <>
        <At x={fr.M} y={fr.M}>
          <Wordmark s={s} size={15} />
        </At>
        <At x={fr.M} y={150} w={leftW}>
          <Label s={s} dot size={15}>
            {f.kicker}
          </Label>
          <div style={{ display: "flex", marginTop: 26 }}>
            <Display s={s} size={fit(f.headline, leftW, 3, 76, 34)}>
              {f.headline}
            </Display>
          </div>
        </At>
        {f.body ? (
          <Glass s={s} rect={{ x: 724, y: 150, w: 420, h: 270 }} pad={36} inner={{ justifyContent: "center" }}>
            <div style={{ display: "block", fontSize: 23, lineHeight: 1.4, color: ink(s), lineClamp: 7 }}>{f.body}</div>
          </Glass>
        ) : null}
        {cta ? ctaPill({ x: 724, y: fr.H - fr.M - 84, w: 420, h: 84 }, 21) : null}
      </>
    );
  }

  const w = fr.W - fr.M * 2;
  const geo = {
    tall: { head: 420, lines: 5, max: 150, card: { y: 1130, h: 300 }, pill: 1470, body: 34 },
    portrait: { head: 210, lines: 4, max: 136, card: { y: 820, h: 270 }, pill: 1130, body: 32 },
    square: { head: 180, lines: 3, max: 118, card: { y: 610, h: 220 }, pill: 872, body: 29 },
  }[fr.shape as "tall" | "portrait" | "square"];
  const pillW = Math.min(w, pillWidth(cta, 28) + 80);
  return (
    <>
      <Header s={s} fr={fr} right={f.kicker} />
      <At x={fr.M} y={geo.head} w={w}>
        <Display s={s} size={fit(f.headline, w, geo.lines, geo.max, 56)}>
          {f.headline}
        </Display>
      </At>
      {f.body ? (
        <Glass s={s} rect={{ x: fr.M, y: geo.card.y, w, h: geo.card.h }} pad="44px 50px" inner={{ justifyContent: "center" }}>
          <div style={{ display: "block", fontSize: geo.body, lineHeight: 1.38, letterSpacing: -0.3, color: ink(s), lineClamp: 4 }}>{f.body}</div>
        </Glass>
      ) : null}
      {cta ? ctaPill({ x: fr.M, y: geo.pill, w: pillW, h: 104 }, 28) : null}
    </>
  );
}

export function renderTemplate({ template, format, scene, fields, assets }: RenderInput) {
  const fr = frameOf(format);
  let body: ReactNode;
  switch (template) {
    case "award":
      body = <SiteCard s={scene} fr={fr} f={fields} a={assets} award />;
      break;
    case "new_listing":
      body = <SiteCard s={scene} fr={fr} f={fields} a={assets} award={false} />;
      break;
    case "call_submissions":
    case "call_jury":
    case "announcement":
      body = <Call s={scene} fr={fr} f={fields} />;
      break;
    case "jury_quote":
      body = <JuryQuote s={scene} fr={fr} f={fields} />;
      break;
    case "screenshot":
      body = <ScreenshotSlide s={scene} fr={fr} f={fields} a={assets} />;
      break;
  }
  return (
    <Canvas s={scene} fr={fr} back={assets.back}>
      {body}
    </Canvas>
  );
}

/** How wide to prepare the screenshot for a format's browser window. */
export function shotWidth(format: FormatId) {
  return Math.round(browserRect(frameOf(format)).w * 1.35);
}
