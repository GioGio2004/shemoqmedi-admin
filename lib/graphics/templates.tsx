/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { CSSProperties, ReactNode } from "react";
import { alpha, inkOn, luminance, type Palette } from "@/lib/palettes";
import { FORMATS, TIERS, type FormatId, type TemplateId, type Tier } from "./spec";

// JSX for satori (next/og). Satori lays out with flexbox only: every element
// with more than one child needs display:flex, and there is no grid, no
// em/rem and no CSS variables. Sizes are px on the final canvas.
//
// One layout system for every template, Kencho-style: a thin header row
// (wordmark, kicker), generous margins, one big headline, and a footer row
// (site address, date). Colours follow the palette's 60/30/10 roles: base is
// the background, surface fills the one large block (the screenshot panel,
// the call's body band), accent marks only small things (the chip, the CTA).

export type Images = Record<string, string | null>;

export type RenderInput = {
  template: TemplateId;
  format: FormatId;
  palette: Palette;
  fields: Record<string, string>;
  images: Images;
};

type Box = {
  w: number;
  h: number;
  /** Outer margin. */
  m: number;
  /** Wide (link) format: text and image side by side. */
  wide: boolean;
  /** Story format: extra vertical room. */
  tall: boolean;
};

function box(format: FormatId): Box {
  const { width: w, height: h } = FORMATS[format];
  const wide = w / h > 1.3;
  return { w, h, m: wide ? 64 : 80, wide, tall: h / w > 1.6 };
}

/** Shrink a headline until it fits `lines` lines of `width` px (Inter ≈ 0.54em per character). */
function fit(text: string, width: number, lines: number, max: number, min = 28) {
  const chars = Math.max(text.length, 1);
  const size = (width * lines) / (chars * 0.54);
  return Math.round(Math.max(min, Math.min(max, size)));
}

/** The accent, unless it would vanish on `fill` (house: near-black on black); then the base colour. */
function accentOn(p: Palette, fill: string) {
  const [a, b] = [luminance(p.accent), luminance(fill)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05) < 1.6 ? p.base : p.accent;
}

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

/** Wide formats: a browser window about as wide as a desktop screenshot, running off the canvas edge. */
function bleedW(b: Box) {
  return Math.round((b.h - 56) * 1.62);
}

const row: CSSProperties = { display: "flex", flexDirection: "row" };
const col: CSSProperties = { display: "flex", flexDirection: "column" };

// ─────────────────────────────────────────────────────────────────────────────
// Shared pieces
// ─────────────────────────────────────────────────────────────────────────────

function Wordmark({ color, size }: { color: string; size: number }) {
  return (
    <div style={{ ...row, alignItems: "baseline", color, fontSize: size, fontWeight: 700, letterSpacing: size * 0.14 }}>
      SHEMOQMEDI
      <span style={{ marginLeft: size * 0.5, fontWeight: 500, opacity: 0.55, letterSpacing: size * 0.3 }}>SPACE</span>
    </div>
  );
}

/** A small filled label: the accent's one big moment. */
function Chip({ p, size, children }: { p: Palette; size: number; children: ReactNode }) {
  return (
    <div
      style={{
        ...row,
        alignItems: "center",
        background: p.accent,
        color: inkOn(p.accent),
        fontSize: size,
        fontWeight: 600,
        letterSpacing: size * 0.02,
        padding: `${size * 0.42}px ${size * 0.8}px`,
        borderRadius: size * 0.25,
      }}
    >
      {children}
    </div>
  );
}

function Header({ p, b, kicker }: { p: Palette; b: Box; kicker?: string }) {
  const ink = inkOn(p.base);
  const size = b.wide ? 18 : 22;
  return (
    <div style={{ ...row, alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <Wordmark color={ink} size={size} />
      {kicker ? (
        <div style={{ ...row, alignItems: "center", color: alpha(ink, 0.7), fontSize: size, fontWeight: 500 }}>
          <div style={{ width: size * 0.55, height: size * 0.55, background: p.accent, marginRight: size * 0.6 }} />
          {kicker}
        </div>
      ) : null}
    </div>
  );
}

function Footer({ p, b, left, right }: { p: Palette; b: Box; left?: string; right?: string }) {
  const ink = inkOn(p.base);
  const size = b.wide ? 18 : 22;
  return (
    <div
      style={{
        ...row,
        justifyContent: "space-between",
        width: "100%",
        paddingTop: size * 1.1,
        borderTop: `2px solid ${alpha(ink, 0.12)}`,
        color: alpha(ink, 0.6),
        fontSize: size,
        fontWeight: 500,
      }}
    >
      <span>{left ?? "shemoqmedi.space"}</span>
      <span>{right ?? ""}</span>
    </div>
  );
}

/** Whole canvas in the base colour, with the outer margin. */
function Canvas({ p, b, children, padded = true }: { p: Palette; b: Box; children: ReactNode; padded?: boolean }) {
  return (
    <div
      style={{
        ...col,
        width: b.w,
        height: b.h,
        background: p.base,
        color: inkOn(p.base),
        fontFamily: "Inter",
        padding: padded ? b.m : 0,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A screenshot in a clean browser window: a slim title bar with three dots
 * and the address, then the page, cropped from the top. With no screenshot,
 * an empty page in the surface colour stands in.
 */
function Browser({
  p,
  src,
  url,
  width,
  height,
  on,
}: {
  p: Palette;
  src: string | null;
  url?: string;
  width: number;
  height: number;
  /** The colour the window sits on (for its edge). */
  on: string;
}) {
  const bar = Math.round(Math.max(30, width * 0.042));
  const chrome = "#F4F4F2";
  const dot = Math.round(bar * 0.26);
  const radius = Math.round(bar * 0.4);
  return (
    <div
      style={{
        ...col,
        width,
        height,
        borderRadius: radius,
        overflow: "hidden",
        background: chrome,
        border: `1px solid ${alpha(inkOn(on), 0.16)}`,
      }}
    >
      <div style={{ ...row, alignItems: "center", height: bar, padding: `0 ${bar * 0.5}px`, background: chrome }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{ width: dot, height: dot, borderRadius: dot, background: "#D4D4D0", marginRight: dot * 0.7 }}
          />
        ))}
        {url ? (
          <div style={{ ...row, flex: 1, justifyContent: "center", marginRight: dot * 5 }}>
            <div
              style={{
                ...row,
                padding: `${bar * 0.1}px ${bar * 0.6}px`,
                borderRadius: bar,
                background: "#FFFFFF",
                color: "#5A5A58",
                fontSize: Math.round(bar * 0.4),
                fontWeight: 500,
              }}
            >
              {hostOf(url)}
            </div>
          </div>
        ) : null}
      </div>
      {src ? (
        <img
          src={src}
          width={width}
          height={height - bar}
          style={{ width, height: height - bar, objectFit: "cover", objectPosition: "top" }}
        />
      ) : (
        <div style={{ ...col, width, height: height - bar, background: alpha(p.surface, 0.25) }} />
      )}
    </div>
  );
}

/** The largest desktop-shaped browser window (1.7:1 page under the title bar) inside maxW × maxH. */
function desktopWindow(maxW: number, maxH: number) {
  const bar = (w: number) => Math.round(Math.max(30, w * 0.042));
  let width = maxW;
  if (width / 1.7 + bar(width) > maxH) width = Math.floor((maxH - bar(maxW)) * 1.7);
  return { width, height: Math.round(width / 1.7 + bar(width)) };
}

/**
 * Height of the bottom screenshot panel: at most `share` of the canvas, and
 * never taller than a wide desktop-shaped window (1.9:1 plus the title bar), so a
 * landscape screenshot is only ever cropped at the bottom, never at the sides.
 */
function screenPanelHeight(b: Box, share: number) {
  const windowW = b.w - b.m * 2;
  const bar = Math.round(Math.max(30, windowW * 0.042));
  return Math.round(Math.min(b.h * share, b.m + windowW / 1.9 + bar));
}

/** The surface-coloured panel a browser window sits in, flush to the edges it touches. */
function ScreenPanel({
  p,
  src,
  url,
  width,
  height,
  inset,
}: {
  p: Palette;
  src: string | null;
  url?: string;
  width: number;
  height: number;
  inset: number;
}) {
  return (
    <div
      style={{
        ...col,
        width,
        height,
        background: p.surface,
        alignItems: "center",
        justifyContent: "flex-end",
        padding: `${inset}px ${inset}px 0`,
      }}
    >
      <Browser
        p={p}
        src={src}
        url={url}
        width={width - inset * 2}
        height={height - inset}
        on={p.surface}
      />
    </div>
  );
}

function Title({ text, size, color }: { text: string; size: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        lineHeight: 1.02,
        fontWeight: 600,
        letterSpacing: -size * 0.035,
        color,
      }}
    >
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

/** Fallback mark when the badge image is not available: the tier in a square. */
function TierMark({ p, tier, size }: { p: Palette; tier: Tier; size: number }) {
  return (
    <div
      style={{
        ...col,
        width: size,
        height: size,
        borderRadius: size,
        alignItems: "center",
        justifyContent: "center",
        background: p.accent,
        color: inkOn(p.accent),
        fontSize: size * 0.26,
        fontWeight: 700,
        letterSpacing: size * 0.01,
      }}
    >
      {tier}
    </div>
  );
}

function Award({ p, b, f, images }: { p: Palette; b: Box; f: Record<string, string>; images: Images }) {
  const ink = inkOn(p.base);
  const tier = (f.tier in TIERS ? f.tier : "SOTD") as Tier;
  const kicker = TIERS[tier];
  const badgeSize = b.wide ? 150 : b.tall ? 240 : 200;
  const badge = images.badge ? (
    <img src={images.badge} width={badgeSize} height={badgeSize} style={{ width: badgeSize, height: badgeSize }} />
  ) : (
    <TierMark p={p} tier={tier} size={badgeSize} />
  );

  if (b.wide) {
    const textW = Math.round(b.w * 0.44);
    const panelW = b.w - textW - b.m;
    return (
      <div style={{ ...row, width: b.w, height: b.h, background: p.base, color: ink, fontFamily: "Inter" }}>
        <div style={{ ...col, width: textW + b.m, height: b.h, padding: b.m, paddingRight: b.m * 0.75 }}>
          <Header p={p} b={b} />
          <div style={{ ...col, flex: 1, justifyContent: "center" }}>
            <div style={{ ...row, marginBottom: 26 }}>
              <Chip p={p} size={20}>
                {kicker}
              </Chip>
            </div>
            <Title text={f.title} size={fit(f.title, textW, 2, 64)} color={ink} />
            <div style={{ display: "flex", marginTop: 16, fontSize: 26, color: alpha(ink, 0.65), fontWeight: 500 }}>
              by {f.studio}
            </div>
          </div>
          <Footer p={p} b={b} right={f.date} />
        </div>
        <div style={{ ...col, width: panelW, height: b.h, background: p.surface, position: "relative", overflow: "hidden" }}>
          <div style={{ ...col, position: "absolute", left: 56, top: 56 }}>
            <Browser p={p} src={images.screenshot} url={f.url} width={bleedW(b)} height={b.h - 56} on={p.surface} />
          </div>
          <div style={{ ...col, position: "absolute", right: 28, bottom: 28 }}>{badge}</div>
        </div>
      </div>
    );
  }

  const textW = b.w - b.m * 2;
  const panelH = screenPanelHeight(b, b.h > b.w ? 0.47 : 0.42);
  return (
    <Canvas p={p} b={b} padded={false}>
      <div style={{ ...col, flex: 1, padding: `${b.m}px ${b.m}px ${b.m * 0.8}px` }}>
        <Header p={p} b={b} kicker={f.date} />
        <div style={{ ...row, flex: 1, alignItems: b.tall ? "center" : "flex-end", justifyContent: "space-between" }}>
          <div style={{ ...col, width: textW - badgeSize - 40 }}>
            <div style={{ ...row, marginBottom: b.tall ? 40 : 28 }}>
              <Chip p={p} size={24}>
                {kicker}
              </Chip>
            </div>
            <Title
              text={f.title}
              size={fit(f.title, textW - badgeSize - 40, b.h > b.w ? 3 : 2, b.tall ? 120 : 104)}
              color={ink}
            />
            <div style={{ display: "flex", marginTop: 20, fontSize: 34, color: alpha(ink, 0.65), fontWeight: 500 }}>
              by {f.studio}
            </div>
          </div>
          {badge}
        </div>
      </div>
      <ScreenPanel p={p} src={images.screenshot} url={f.url} width={b.w} height={panelH} inset={b.m} />
    </Canvas>
  );
}

function NewListing({ p, b, f, images }: { p: Palette; b: Box; f: Record<string, string>; images: Images }) {
  const ink = inkOn(p.base);
  if (b.wide) {
    const textW = Math.round(b.w * 0.42);
    const panelW = b.w - textW - b.m;
    return (
      <div style={{ ...row, width: b.w, height: b.h, background: p.base, color: ink, fontFamily: "Inter" }}>
        <div style={{ ...col, width: textW + b.m, height: b.h, padding: b.m, paddingRight: b.m * 0.75 }}>
          <Header p={p} b={b} />
          <div style={{ ...col, flex: 1, justifyContent: "center" }}>
            <div style={{ ...row, marginBottom: 24 }}>
              <Chip p={p} size={18}>
                {f.kicker}
              </Chip>
            </div>
            <Title text={f.title} size={fit(f.title, textW, 2, 60)} color={ink} />
            <div style={{ display: "flex", marginTop: 14, fontSize: 24, color: alpha(ink, 0.65), fontWeight: 500 }}>
              by {f.studio}
            </div>
            {f.tagline ? (
              <div
                style={{ display: "block", marginTop: 22, fontSize: 21, lineHeight: 1.4, color: alpha(ink, 0.8), lineClamp: 3 }}
              >
                {f.tagline}
              </div>
            ) : null}
          </div>
          <Footer p={p} b={b} />
        </div>
        <div style={{ ...col, width: panelW, height: b.h, background: p.surface, position: "relative", overflow: "hidden" }}>
          <div style={{ ...col, position: "absolute", left: 56, top: 56 }}>
            <Browser p={p} src={images.screenshot} url={f.url} width={bleedW(b)} height={b.h - 56} on={p.surface} />
          </div>
        </div>
      </div>
    );
  }

  const textW = b.w - b.m * 2;
  const panelH = screenPanelHeight(b, b.h > b.w ? 0.5 : 0.44);
  return (
    <Canvas p={p} b={b} padded={false}>
      <div style={{ ...col, flex: 1, padding: `${b.m}px ${b.m}px ${b.m * 0.75}px` }}>
        <Header p={p} b={b} kicker={f.kicker} />
        <div style={{ ...col, flex: 1, justifyContent: b.tall ? "center" : "flex-end" }}>
          <Title text={f.title} size={fit(f.title, textW, b.tall ? 3 : 2, b.tall ? 132 : 108)} color={ink} />
          <div style={{ display: "flex", marginTop: 18, fontSize: 34, color: alpha(ink, 0.65), fontWeight: 500 }}>
            by {f.studio}
          </div>
          {f.tagline ? (
            <div
              style={{
                display: "block",
                marginTop: 28,
                width: textW * 0.86,
                fontSize: b.h > b.w ? 30 : 27,
                lineHeight: 1.4,
                color: alpha(ink, 0.8),
                lineClamp: 3,
              }}
            >
              {f.tagline}
            </div>
          ) : null}
        </div>
      </div>
      <ScreenPanel p={p} src={images.screenshot} url={f.url} width={b.w} height={panelH} inset={b.m} />
    </Canvas>
  );
}

/** Call for submissions, call for jury, announcement: headline on base, body + CTA in the surface band. */
function Call({ p, b, f }: { p: Palette; b: Box; f: Record<string, string> }) {
  const ink = inkOn(p.base);
  const sInk = inkOn(p.surface);
  const textW = b.w - b.m * 2;
  const cta = f.cta ? hostOf(f.cta) : "";
  const ctaFill = accentOn(p, p.surface);

  const ctaEl = cta ? (
    <div style={{ ...row }}>
      <div
        style={{
          ...row,
          alignItems: "center",
          background: ctaFill,
          color: inkOn(ctaFill),
          fontSize: b.wide ? 22 : 30,
          fontWeight: 600,
          padding: b.wide ? "16px 26px" : "22px 34px",
          borderRadius: 6,
        }}
      >
        {cta}
        <svg
          width={b.wide ? 20 : 26}
          height={b.wide ? 20 : 26}
          viewBox="0 0 24 24"
          style={{ marginLeft: b.wide ? 14 : 18 }}
        >
          <path d="M5 12h13M13 6l6 6-6 6" stroke={inkOn(ctaFill)} strokeWidth="2.4" fill="none" />
        </svg>
      </div>
    </div>
  ) : null;

  if (b.wide) {
    const bandW = Math.round(b.w * 0.36);
    const leftW = b.w - bandW;
    return (
      <div style={{ ...row, width: b.w, height: b.h, background: p.base, color: ink, fontFamily: "Inter" }}>
        <div style={{ ...col, width: leftW, height: b.h, padding: b.m }}>
          <Header p={p} b={b} />
          <div style={{ ...col, flex: 1, justifyContent: "center" }}>
            <Title text={f.headline} size={fit(f.headline, leftW - b.m * 2, 3, 76)} color={ink} />
          </div>
          <Footer p={p} b={b} left={f.kicker} />
        </div>
        <div
          style={{
            ...col,
            width: bandW,
            height: b.h,
            background: p.surface,
            color: sInk,
            padding: b.m * 0.8,
            justifyContent: "flex-end",
          }}
        >
          {f.body ? (
            <div style={{ display: "block", fontSize: 24, lineHeight: 1.42, marginBottom: 32, lineClamp: 7 }}>{f.body}</div>
          ) : null}
          {ctaEl}
        </div>
      </div>
    );
  }

  return (
    <Canvas p={p} b={b} padded={false}>
      <div style={{ ...col, flex: 1, padding: `${b.m}px ${b.m}px ${b.m}px` }}>
        <Header p={p} b={b} kicker={f.kicker} />
        <div style={{ ...col, flex: 1, justifyContent: "center" }}>
          <Title
            text={f.headline}
            size={fit(f.headline, textW, b.tall ? 5 : b.h > b.w ? 4 : 3, b.tall ? 150 : 132)}
            color={ink}
          />
        </div>
      </div>
      {/* The surface band: as tall as its text, at least ~30% of the canvas. */}
      <div
        style={{
          ...col,
          minHeight: Math.round(b.h * (b.h > b.w ? 0.3 : 0.32)),
          background: p.surface,
          color: sInk,
          padding: `${b.m * 0.9}px ${b.m}px ${b.m}px`,
          justifyContent: "flex-end",
        }}
      >
        {f.body ? (
          <div
            style={{
              display: "block",
              width: textW * 0.9,
              fontSize: b.tall ? 36 : b.h > b.w ? 32 : 29,
              lineHeight: 1.38,
              marginBottom: b.h > b.w ? 40 : 32,
              lineClamp: 4,
            }}
          >
            {f.body}
          </div>
        ) : null}
        {ctaEl}
      </div>
    </Canvas>
  );
}

function JuryQuote({ p, b, f, images }: { p: Palette; b: Box; f: Record<string, string>; images: Images }) {
  const ink = inkOn(p.base);
  const sInk = inkOn(p.surface);
  const textW = b.w - b.m * 2;
  const quote = f.quote.replace(/^["“]|["”]$/g, "");
  // Drawn, not typed: Inter's “ is slanted bars at this size.
  const mark = (size: number) => (
    <svg width={size} height={size * 0.85} viewBox="0 0 52 44" style={{ marginBottom: size * 0.3 }}>
      <path
        d="M0 44V26C0 12 7 3 20 0l2 6C14 9 10 14 10 22h10v22zM30 44V26C30 12 37 3 50 0l2 6C44 9 40 14 40 22h10v22z"
        fill={accentOn(p, p.base) === p.base ? ink : p.accent}
      />
    </svg>
  );
  const attribution = (color: string, size: number) => (
    <div style={{ ...row, alignItems: "center" }}>
      <div style={{ width: size * 1.6, height: 2, background: color, marginRight: size * 0.7, opacity: 0.5 }} />
      <div style={{ ...col }}>
        <span style={{ fontSize: size, fontWeight: 600, color }}>{f.juror}</span>
        {f.role ? (
          <span style={{ fontSize: size * 0.8, fontWeight: 400, color: alpha(color, 0.65), marginTop: 4 }}>{f.role}</span>
        ) : null}
      </div>
    </div>
  );

  if (b.wide) {
    const sideW = Math.round(b.w * 0.34);
    const leftW = b.w - sideW;
    return (
      <div style={{ ...row, width: b.w, height: b.h, background: p.base, color: ink, fontFamily: "Inter" }}>
        <div style={{ ...col, width: leftW, height: b.h, padding: b.m }}>
          <Header p={p} b={b} kicker="From the jury" />
          <div style={{ ...col, flex: 1, justifyContent: "center" }}>
            {mark(64)}
            <div style={{ display: "flex", fontSize: fit(quote, leftW - b.m * 2, 4, 46, 24), lineHeight: 1.22, fontWeight: 500, letterSpacing: -0.6 }}>
              {quote}
            </div>
          </div>
          {attribution(ink, 22)}
        </div>
        <div style={{ ...col, width: sideW, height: b.h, background: p.surface, color: sInk, padding: 40, justifyContent: "space-between" }}>
          {images.screenshot ? (
            <Browser p={p} src={images.screenshot} {...desktopWindow(sideW - 80, b.h)} on={p.surface} />
          ) : (
            <div style={{ display: "flex" }} />
          )}
          <div style={{ ...col }}>
            <span style={{ fontSize: 18, color: alpha(sInk, 0.6), fontWeight: 500 }}>On</span>
            <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.6, marginTop: 4 }}>{f.site}</span>
          </div>
        </div>
      </div>
    );
  }

  const bandH = Math.round(b.h * (images.screenshot ? (b.tall ? 0.29 : 0.3) : 0.2));
  const thumb = desktopWindow(Math.round(b.w * 0.55), bandH - b.m * 0.6);
  return (
    <Canvas p={p} b={b} padded={false}>
      <div style={{ ...col, flex: 1, padding: b.m }}>
        <Header p={p} b={b} kicker="From the jury" />
        <div style={{ ...col, flex: 1, justifyContent: "center" }}>
          {mark(b.tall ? 110 : 92)}
          <div
            style={{
              display: "flex",
              fontSize: fit(quote, textW, b.tall ? 7 : b.h > b.w ? 6 : 5, b.tall ? 76 : 66, 30),
              lineHeight: 1.2,
              fontWeight: 500,
              letterSpacing: -1,
            }}
          >
            {quote}
          </div>
          <div style={{ ...row, marginTop: b.tall ? 64 : 48 }}>{attribution(ink, 30)}</div>
        </div>
      </div>
      <div
        style={{
          ...row,
          height: bandH,
          background: p.surface,
          color: sInk,
          padding: `0 ${b.m}px`,
          alignItems: images.screenshot ? "flex-end" : "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ ...col, paddingBottom: images.screenshot ? b.m : 0, alignSelf: images.screenshot ? "flex-end" : "center" }}>
          <span style={{ fontSize: 22, color: alpha(sInk, 0.6), fontWeight: 500 }}>On</span>
          <span style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1, marginTop: 6 }}>{f.site}</span>
        </div>
        {images.screenshot ? (
          <Browser p={p} src={images.screenshot} {...thumb} on={p.surface} />
        ) : (
          <span style={{ fontSize: 22, color: alpha(sInk, 0.6), fontWeight: 500 }}>shemoqmedi.space</span>
        )}
      </div>
    </Canvas>
  );
}

/** One framed screenshot for an Instagram carousel. */
function Screenshot({ p, b, f, images }: { p: Palette; b: Box; f: Record<string, string>; images: Images }) {
  const ink = inkOn(p.base);
  const caption = [f.title, f.studio && `by ${f.studio}`].filter(Boolean).join(" ");
  const innerW = b.w - b.m * 2;
  const inset = Math.round(b.m * (b.wide ? 0.6 : 0.75));
  // A desktop-shaped window in a surface panel just big enough to hold it.
  const win = desktopWindow(innerW - inset * 2, b.h - b.m * 2 - 140 - inset * 2);
  const panelH = win.height + inset * 2;
  return (
    <Canvas p={p} b={b}>
      <Header p={p} b={b} kicker={f.index} />
      <div style={{ ...col, flex: 1, justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            ...col,
            width: innerW,
            height: panelH,
            background: p.surface,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
          }}
        >
          <Browser
            p={p}
            src={images.screenshot}
            url={f.url}
            {...win}
            on={p.surface}
          />
        </div>
      </div>
      <div style={{ ...row, justifyContent: "space-between", marginTop: 30, fontSize: b.wide ? 18 : 24, fontWeight: 500 }}>
        <span style={{ color: ink }}>{caption}</span>
        <span style={{ color: alpha(ink, 0.6) }}>shemoqmedi.space</span>
      </div>
    </Canvas>
  );
}

export function renderTemplate({ template, format, palette, fields, images }: RenderInput) {
  const b = box(format);
  const props = { p: palette, b, f: fields, images };
  switch (template) {
    case "award":
      return <Award {...props} />;
    case "new_listing":
      return <NewListing {...props} />;
    case "call_submissions":
    case "call_jury":
    case "announcement":
      return <Call {...props} />;
    case "jury_quote":
      return <JuryQuote {...props} />;
    case "screenshot":
      return <Screenshot {...props} />;
  }
}
