/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { CSSProperties, ReactNode } from "react";
import { alpha, type Palette } from "@/lib/palettes";

// The glass language of the social graphics, for satori.
//
// Satori has no backdrop-filter, so glass is faked the honest way: every
// panel holds a copy of the frost layer (the backdrop blurred further and
// lightened, lib/graphics/imaging.ts) placed so it lines up exactly with the
// backdrop behind it, then a white fill, a 1px light edge, a soft top-left
// highlight and a large soft shadow. Everything glass is absolutely
// positioned in canvas (or panorama) coordinates, so that alignment is exact.

export type GlassStyle = "frost" | "liquid" | "tint";

export type Scene = {
  palette: Palette;
  /** Light backdrop: near-black text and milkier glass. */
  light: boolean;
  /** The frost layer for the visible window, and where that window sits in world coordinates. */
  frost: string | null;
  view: { x: number; y: number; w: number; h: number };
  style: GlassStyle;
};

export type Rect = { x: number; y: number; w: number; h: number };

export const row: CSSProperties = { display: "flex", flexDirection: "row" };
export const col: CSSProperties = { display: "flex", flexDirection: "column" };

export function ink(s: Scene) {
  return s.light ? "#0B0B0C" : "#FFFFFF";
}

export function soft(s: Scene, a = 0.68) {
  return alpha(ink(s), a);
}

/** The brand's one colour of its own: the score tiles' blue (storefront .score-tile). */
export const SCORE_BLUE = "rgba(0, 64, 255, 0.78)";

// ─────────────────────────────────────────────────────────────────────────────
// Glass
// ─────────────────────────────────────────────────────────────────────────────

function treatment(s: Scene) {
  const L = s.light;
  switch (s.style) {
    case "liquid":
      return {
        fill: L ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.07)",
        rim: `linear-gradient(140deg, rgba(255,255,255,${L ? 0.95 : 0.7}) 0%, rgba(255,255,255,0.12) 34%, rgba(255,255,255,0.04) 62%, rgba(255,255,255,${L ? 0.7 : 0.42}) 100%)`,
        highlight: `radial-gradient(120% 70% at 12% 0%, rgba(255,255,255,${L ? 0.55 : 0.26}) 0%, rgba(255,255,255,0) 60%)`,
        shade: `linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,${L ? 0.03 : 0.12}) 100%)`,
        shadow: `0 34px 80px rgba(0,0,0,${L ? 0.16 : 0.32}), 0 6px 18px rgba(0,0,0,${L ? 0.06 : 0.14})`,
      };
    case "tint":
      return {
        fill: alpha(s.palette.surface, L ? 0.22 : 0.3),
        rim: `linear-gradient(160deg, rgba(255,255,255,0.4), rgba(255,255,255,0.14))`,
        highlight: `linear-gradient(135deg, rgba(255,255,255,${L ? 0.3 : 0.16}) 0%, rgba(255,255,255,0) 42%)`,
        shade: "none",
        shadow: `0 40px 120px ${alpha(s.palette.accent, 0.22)}`,
      };
    default:
      return {
        fill: L ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.13)",
        rim: `linear-gradient(160deg, rgba(255,255,255,${L ? 0.85 : 0.42}), rgba(255,255,255,${L ? 0.5 : 0.22}))`,
        highlight: `linear-gradient(135deg, rgba(255,255,255,${L ? 0.5 : 0.3}) 0%, rgba(255,255,255,0.04) 38%, rgba(255,255,255,0) 60%)`,
        shade: "none",
        shadow: `0 40px 90px rgba(0,0,0,${L ? 0.14 : 0.3})`,
      };
  }
}

/**
 * One glass panel at `rect` (world coordinates). Children are laid out with
 * flex inside it; `pad` is the inner padding.
 */
export function Glass({
  s,
  rect,
  radius = 36,
  pad = 0,
  children,
  inner,
  fill,
  edge = 1,
}: {
  s: Scene;
  rect: Rect;
  radius?: number;
  pad?: number | string;
  children?: ReactNode;
  /** Extra style for the content box (direction, alignment…). */
  inner?: CSSProperties;
  /** Override the fill (the blue score tiles). */
  fill?: string;
  /** Rim thickness. */
  edge?: number;
}) {
  const t = treatment(s);
  const { x, y, w, h } = rect;
  const r = Math.max(0, radius - edge);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        display: "flex",
        borderRadius: radius,
        padding: edge,
        backgroundImage: t.rim,
        boxShadow: t.shadow,
        overflow: "hidden",
      }}
    >
      {/* Every layer carries the radius itself: satori clips absolute children to the box, not to its rounded corners. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          width: w - edge * 2,
          height: h - edge * 2,
          borderRadius: r,
          overflow: "hidden",
          backgroundColor: s.light ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.04)",
          ...(s.frost
            ? {
                backgroundImage: `url(${s.frost})`,
                backgroundSize: `${s.view.w}px ${s.view.h}px`,
                backgroundPosition: `${s.view.x - x - edge}px ${s.view.y - y - edge}px`,
                backgroundRepeat: "no-repeat",
              }
            : {}),
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, display: "flex", borderRadius: r, background: fill ?? t.fill }} />
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, display: "flex", borderRadius: r, backgroundImage: t.highlight }} />
        {t.shade !== "none" ? (
          <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, display: "flex", borderRadius: r, backgroundImage: t.shade }} />
        ) : null}
        <div style={{ ...col, position: "relative", width: "100%", height: "100%", padding: pad, ...inner }}>{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Type
// ─────────────────────────────────────────────────────────────────────────────

/** Small uppercase label with wide tracking. */
export function Label({ s, size = 19, color, children, dot }: { s: Scene; size?: number; color?: string; children: ReactNode; dot?: boolean }) {
  return (
    <div
      style={{
        ...row,
        alignItems: "center",
        fontSize: size,
        fontWeight: 600,
        letterSpacing: size * 0.24,
        textTransform: "uppercase",
        color: color ?? soft(s, 0.78),
      }}
    >
      {dot ? (
        <div style={{ width: size * 0.5, height: size * 0.5, borderRadius: size, background: s.palette.accent, marginRight: size * 0.7 }} />
      ) : null}
      {children}
    </div>
  );
}

/** Display type: tight, heavy, large. */
export function Display({ s, size, children, weight = 700, color, maxWidth }: { s: Scene; size: number; children: ReactNode; weight?: number; color?: string; maxWidth?: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        fontWeight: weight,
        lineHeight: 0.94,
        letterSpacing: -size * 0.048,
        color: color ?? ink(s),
        ...(maxWidth ? { maxWidth } : {}),
      }}
    >
      {children}
    </div>
  );
}

/** Lines `text` wraps to at `size` px in `width` px (greedy word wrap; Inter display ≈ 0.57em per character). */
export function wrapLines(text: string, width: number, size: number, charW = 0.57) {
  const per = width / (size * charW);
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const len = word.length;
    if (len > per) return Infinity; // a word wider than the line
    if (used === 0) used = len;
    else if (used + 1 + len <= per) used += 1 + len;
    else {
      lines++;
      used = len;
    }
  }
  return lines;
}

/** The largest size (≤ max) at which `text` fits in `lines` lines of `width` px, and in `height` px when given. */
export function fit(text: string, width: number, lines: number, max: number, min = 28, height?: number, lineHeight = 0.95) {
  for (let size = Math.round(max); size > min; size -= 2) {
    const n = wrapLines(text, width, size);
    if (n <= lines && (!height || n * size * lineHeight <= height)) return size;
  }
  return min;
}

export function Wordmark({ s, size = 20 }: { s: Scene; size?: number }) {
  return (
    <div style={{ ...row, alignItems: "baseline", color: ink(s), fontSize: size, fontWeight: 700, letterSpacing: size * 0.2 }}>
      SHEMOQMEDI
      <span style={{ marginLeft: size * 0.5, fontWeight: 500, color: soft(s, 0.5), letterSpacing: size * 0.32 }}>SPACE</span>
    </div>
  );
}

export function host(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

/** A glass pill with a label (detail chips, tech chips, CTA). */
export function Pill({ s, rect, children, size = 22, strong }: { s: Scene; rect: Rect; children: ReactNode; size?: number; strong?: boolean }) {
  return (
    <Glass s={s} rect={rect} radius={rect.h / 2} inner={{ alignItems: "center", justifyContent: "center", flexDirection: "row" }}>
      <div style={{ ...row, alignItems: "center", fontSize: size, fontWeight: strong ? 600 : 500, letterSpacing: -size * 0.01, color: ink(s) }}>
        {children}
      </div>
    </Glass>
  );
}

/** Approximate pill width for a label. */
export function pillWidth(text: string, size: number, padX = size * 1.3) {
  return Math.round(text.length * size * 0.56 + padX * 2);
}

/** A browser window of glass around a sharp screenshot. */
export function BrowserGlass({ s, rect, src, url, radius = 34 }: { s: Scene; rect: Rect; src: string | null; url?: string; radius?: number }) {
  const bezel = Math.round(Math.max(10, rect.w * 0.012));
  const bar = Math.round(Math.max(40, rect.w * 0.046));
  const innerW = rect.w - bezel * 2 - 2;
  const imgH = rect.h - bezel * 2 - bar - 2;
  const dot = Math.round(bar * 0.24);
  return (
    <Glass s={s} rect={rect} radius={radius} pad={bezel}>
      <div style={{ ...row, alignItems: "center", height: bar, paddingLeft: bar * 0.3, paddingRight: bar * 0.3 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: dot, height: dot, borderRadius: dot, background: soft(s, 0.35), marginRight: dot * 0.75 }} />
        ))}
        {url ? (
          <div style={{ ...row, flex: 1, justifyContent: "center", marginRight: dot * 5 }}>
            <div
              style={{
                ...row,
                alignItems: "center",
                height: bar * 0.62,
                padding: `0 ${bar * 0.5}px`,
                borderRadius: bar,
                background: s.light ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.14)",
                color: soft(s, 0.8),
                fontSize: Math.round(bar * 0.36),
                fontWeight: 500,
              }}
            >
              {host(url)}
            </div>
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", width: innerW, height: imgH, borderRadius: radius - bezel, overflow: "hidden", background: "#F4F4F2" }}>
        {src ? <img src={src} width={innerW} height={imgH} style={{ width: innerW, height: imgH, objectFit: "cover", objectPosition: "left top" }} /> : null}
      </div>
    </Glass>
  );
}

/** A phone of glass around a tall screenshot. */
export function PhoneGlass({ s, rect, src }: { s: Scene; rect: Rect; src: string | null }) {
  const bezel = Math.round(rect.w * 0.045);
  const innerW = rect.w - bezel * 2 - 2;
  const innerH = rect.h - bezel * 2 - 2;
  const r = Math.round(rect.w * 0.16);
  return (
    <Glass s={s} rect={rect} radius={r} pad={bezel}>
      <div style={{ display: "flex", position: "relative", width: innerW, height: innerH, borderRadius: r - bezel, overflow: "hidden", background: "#F4F4F2" }}>
        {src ? <img src={src} width={innerW} height={innerH} style={{ width: innerW, height: innerH, objectFit: "cover", objectPosition: "left top" }} /> : null}
        <div
          style={{
            position: "absolute",
            top: innerW * 0.035,
            left: innerW * 0.36,
            width: innerW * 0.28,
            height: innerW * 0.075,
            borderRadius: innerW,
            background: "#0B0B0C",
          }}
        />
      </div>
    </Glass>
  );
}

/** One blue score square: the number large, the pillar small. */
export function ScoreTile({ s, rect, value, label }: { s: Scene; rect: Rect; value: string; label: string }) {
  return (
    <Glass s={{ ...s, light: false }} rect={rect} radius={Math.round(rect.w * 0.13)} fill={SCORE_BLUE} pad={Math.round(rect.w * 0.12)} inner={{ justifyContent: "space-between" }}>
      <div style={{ display: "flex", fontSize: Math.round(rect.w * 0.09), fontWeight: 600, letterSpacing: rect.w * 0.02, textTransform: "uppercase", color: "rgba(255,255,255,0.78)" }}>
        {label}
      </div>
      <div style={{ display: "flex", fontSize: Math.round(rect.w * 0.36), fontWeight: 700, letterSpacing: -rect.w * 0.015, lineHeight: 1, color: "#FFFFFF" }}>
        {value}
      </div>
    </Glass>
  );
}

/** The award: the badge art on a glass disc (or the tier in large type when the badge isn't available). */
export function Seal({ s, rect, badge, tier }: { s: Scene; rect: Rect; badge: string | null; tier: string }) {
  const inner = Math.round(rect.w * 0.74);
  return (
    <Glass s={s} rect={rect} radius={rect.w / 2} inner={{ alignItems: "center", justifyContent: "center" }}>
      {badge ? (
        <img src={badge} width={inner} height={inner} style={{ width: inner, height: inner }} />
      ) : (
        <div style={{ display: "flex", fontSize: rect.w * 0.26, fontWeight: 700, letterSpacing: -rect.w * 0.01, color: ink(s) }}>{tier}</div>
      )}
    </Glass>
  );
}

/** Quote marks, drawn (Inter's are slanted bars at display size). */
export function QuoteMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size * 0.85} viewBox="0 0 52 44">
      <path d="M0 44V26C0 12 7 3 20 0l2 6C14 9 10 14 10 22h10v22zM30 44V26C30 12 37 3 50 0l2 6C44 9 40 14 40 22h10v22z" fill={color} />
    </svg>
  );
}

export function Arrow({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M4 12h15M13 6l6 6-6 6" stroke={color} strokeWidth="1.8" fill="none" />
    </svg>
  );
}
