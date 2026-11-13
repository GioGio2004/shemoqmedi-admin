/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { CSSProperties, ReactNode } from "react";
import { TIERS, type FormatId } from "../spec";
import {
  At,
  Arrow,
  CHAR,
  Clamp,
  Page,
  SCORE_BLUE,
  SECTION,
  Shot,
  T,
  chipOf,
  col,
  contentOf,
  detailIndex,
  fade,
  fitSize,
  frameOf,
  hostOf,
  pad2,
  row,
  siteOfStory,
  tierMark,
  type CallContent,
  type FlatStyle,
  type Frame,
  type QuoteContent,
  type ShotContent,
  type SingleInput,
  type SiteContent,
  type SlideInput,
  type Theme,
  visible,
} from "./common";

// Bento. The graphic as a dashboard of rounded tiles, each holding one fact:
// the screenshot, the title, the award, the date, the score, the stack, the
// studio, the address. The palette maps onto tile kinds: the base shows in
// the gutters and the quiet "card" tiles, the surface fills the main text
// tile, the accent fills exactly one small tile; scores keep the brand's blue.

type Box = { x: number; y: number; w: number; h: number };
type Kind = "surface" | "card" | "accent" | "score" | "line";

/** Split `r` along `dir` into parts sized by weight (or by px, for parts given as { px }). */
function split(r: Box, dir: "row" | "col", parts: (number | { px: number })[], gap: number): Box[] {
  const total = dir === "row" ? r.w : r.h;
  const fixed = parts.reduce<number>((sum, p) => sum + (typeof p === "number" ? 0 : p.px), 0);
  const weights = parts.reduce<number>((sum, p) => sum + (typeof p === "number" ? p : 0), 0);
  const free = total - fixed - gap * (parts.length - 1);
  let at = dir === "row" ? r.x : r.y;
  return parts.map((p) => {
    const size = Math.round(typeof p === "number" ? (free * p) / weights : p.px);
    const box = dir === "row" ? { x: at, y: r.y, w: size, h: r.h } : { x: r.x, y: at, w: r.w, h: size };
    at += size + gap;
    return box;
  });
}

function paint(t: Theme, kind: Kind): { bg: string; ink: string; border?: string } {
  switch (kind) {
    case "surface":
      return { bg: t.palette.surface, ink: t.onSurface };
    case "accent":
      return { bg: t.palette.accent, ink: t.onAccent };
    case "score":
      return { bg: SCORE_BLUE, ink: "#FFFFFF" };
    case "line":
      return { bg: t.palette.base, ink: t.ink, border: `2px solid ${fade(t.ink, 0.16)}` };
    default:
      return { bg: fade(t.ink, t.light ? 0.06 : 0.09), ink: t.ink };
  }
}

type Look = { t: Theme; radius: number; pad: number };

function Tile({ look, box, kind, children, style }: { look: Look; box: Box; kind: Kind; children?: ReactNode; style?: CSSProperties }) {
  const c = paint(look.t, kind);
  return (
    <At
      x={box.x}
      y={box.y}
      w={box.w}
      h={box.h}
      style={{ background: c.bg, borderRadius: look.radius, padding: look.pad, overflow: "hidden", justifyContent: "space-between", ...(c.border ? { border: c.border } : {}), ...style }}
    >
      {children}
    </At>
  );
}

function ShotTile({ look, box, src, label }: { look: Look; box: Box; src: string | null; label?: string }) {
  const size = Math.max(14, Math.round(look.pad * 0.5));
  return (
    <At x={box.x} y={box.y} w={box.w} h={box.h} style={{ borderRadius: look.radius, overflow: "hidden", background: look.t.palette.surface }}>
      <Shot src={src} w={box.w} h={box.h} fallback={look.t.palette.surface} radius={look.radius} />
      {label ? (
        <div style={{ ...row, position: "absolute", left: look.pad * 0.6, bottom: look.pad * 0.6, height: size * 2.2, padding: `0 ${size}px`, alignItems: "center", borderRadius: size * 2, background: "rgba(11,11,12,0.72)" }}>
          <div style={{ width: size * 0.5, height: size * 0.5, borderRadius: size, background: "#3DDC84", marginRight: size * 0.6 }} />
          <T size={size} weight={600} color="#FFFFFF">
            {label}
          </T>
        </div>
      ) : null}
    </At>
  );
}

/** A tile's small label, top left. */
function Label({ size, color, children }: { size: number; color: string; children: ReactNode }) {
  return (
    <T size={size} weight={600} color={fade(color, 0.7)} style={{ letterSpacing: size * 0.02 }}>
      {children}
    </T>
  );
}

function Big({ size, color, children, weight = 700, lead = 0.95 }: { size: number; color: string; children: ReactNode; weight?: number; lead?: number }) {
  return (
    <div style={{ display: "flex", fontSize: size, fontWeight: weight, lineHeight: lead, letterSpacing: -size * 0.045, color }}>
      {children}
    </div>
  );
}

function ArrowDisc({ size, bg, fg }: { size: number; bg: string; fg: string }) {
  return (
    <div style={{ ...row, width: size, height: size, borderRadius: size, background: bg, alignItems: "center", justifyContent: "center" }}>
      <Arrow size={size * 0.5} color={fg} weight={2.2} />
    </div>
  );
}

function lookOf(fr: Frame, t: Theme): Look & { P: number; G: number } {
  const wide = fr.shape === "wide";
  return { t, radius: wide ? 22 : fr.shape === "square" ? 30 : 36, pad: wide ? 20 : fr.shape === "square" ? 26 : 32, P: wide ? 20 : fr.shape === "square" ? 32 : 40, G: wide ? 10 : 14 };
}

/** The tiles' area: the whole canvas inside the margin; tall formats keep their tiles inside the safe band. */
function areaOf(fr: Frame, P: number): Box {
  if (fr.shape === "tall") return { x: P, y: fr.safe.top, w: fr.W - P * 2, h: fr.safe.bottom - fr.safe.top };
  return { x: P, y: P, w: fr.W - P * 2, h: fr.H - P * 2 };
}

/** Tall formats: a wordmark above the safe band and the address below it. */
function TallEdges({ fr, t, P, right }: { fr: Frame; t: Theme; P: number; right: string }) {
  if (fr.shape !== "tall") return null;
  return (
    <>
      <At x={P} y={fr.safe.top - 120} w={fr.W - P * 2} style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark size={34} color={t.ink} />
        <T size={26} weight={600} color={fade(t.ink, 0.7)}>
          {right}
        </T>
      </At>
      <At x={P} y={fr.safe.bottom + 70} w={fr.W - P * 2} style={{ ...row, justifyContent: "center" }}>
        <T size={26} weight={600} color={fade(t.ink, 0.7)}>
          shemoqmedi.space
        </T>
      </At>
    </>
  );
}

function Wordmark({ size, color }: { size: number; color: string }) {
  return (
    <div style={{ ...row, alignItems: "baseline" }}>
      <T size={size} weight={700} color={color} style={{ letterSpacing: -size * 0.03 }}>
        Shemoqmedi
      </T>
      <T size={size} weight={400} color={fade(color, 0.55)} style={{ letterSpacing: -size * 0.03 }}>
        .space
      </T>
    </div>
  );
}

function BrandTile({ look, box, kind = "card", note }: { look: Look; box: Box; kind?: Kind; note?: string }) {
  const c = paint(look.t, kind);
  // "Shemoqmedi.space" is about 9 em wide at this tracking.
  const size = Math.min(44, Math.floor((box.w - look.pad * 2) / 9.2), Math.round(box.h / 3));
  return (
    <Tile look={look} box={box} kind={kind}>
      <Label size={Math.max(13, size * 0.45)} color={c.ink}>
        {note ?? "Curated by hand"}
      </Label>
      <Wordmark size={size} color={c.ink} />
    </Tile>
  );
}

function UrlTile({ look, box, url, kind = "line", label = "Visit" }: { look: Look; box: Box; url: string; kind?: Kind; label?: string }) {
  const c = paint(look.t, kind);
  const disc = Math.round(Math.min(box.h - look.pad * 2, 88, box.w * 0.28));
  const text = hostOf(url) || "shemoqmedi.space";
  const size = fitSize(text, { width: box.w - look.pad * 2 - disc - 16, lines: 1, max: Math.min(40, box.h * 0.32), min: 14, charW: CHAR.sans });
  return (
    <Tile look={look} box={box} kind={kind} style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <div style={{ ...col, height: "100%", justifyContent: "space-between" }}>
        <Label size={Math.max(13, size * 0.55)} color={c.ink}>
          {label}
        </Label>
        <T size={size} weight={600} color={c.ink} style={{ letterSpacing: -size * 0.02 }}>
          {text}
        </T>
      </div>
      <ArrowDisc size={disc} bg={c.ink} fg={c.bg} />
    </Tile>
  );
}

function AwardTile({ look, box, c, badge }: { look: Look; box: Box; c: SiteContent; badge: string | null }) {
  const p = paint(look.t, "accent");
  const disc = Math.min(box.w, box.h) - look.pad * 1.2;
  if (c.award && badge) {
    return (
      <Tile look={look} box={box} kind="accent" style={{ alignItems: "center", justifyContent: "center", padding: 0 }}>
        <img src={badge} width={disc} height={disc} style={{ width: disc, height: disc }} />
      </Tile>
    );
  }
  return (
    <Tile look={look} box={box} kind="accent">
      <Label size={Math.max(13, box.h * 0.09)} color={p.ink}>
        {c.award ? "Award" : "Fresh"}
      </Label>
      <div style={{ ...col }}>
        <Big size={Math.min(box.h * 0.42, box.w / (tierMark(c.tier).length * 0.62))} color={p.ink}>
          {c.award ? tierMark(c.tier) : "New"}
        </Big>
        <T size={Math.max(13, box.h * 0.09)} weight={600} color={p.ink} style={{ marginTop: 6 }}>
          {c.award ? TIERS[c.tier] : "on Shemoqmedi"}
        </T>
      </div>
    </Tile>
  );
}

function DateTile({ look, box, date, kind = "card" }: { look: Look; box: Box; date: string; kind?: Kind }) {
  const c = paint(look.t, kind);
  const [day, mon, year] = date.split(" ");
  return (
    <Tile look={look} box={box} kind={kind}>
      <Label size={Math.max(13, box.h * 0.09)} color={c.ink}>
        {year ? `${mon} ${year}` : "Date"}
      </Label>
      <Big size={Math.min(box.h * 0.55, box.w * 0.6)} color={c.ink}>
        {day || "—"}
      </Big>
    </Tile>
  );
}

function TitleTile({ look, box, kicker, title, by, kind = "surface", lines = 3 }: { look: Look; box: Box; kicker: string; title: string; by?: string; kind?: Kind; lines?: number }) {
  const c = paint(look.t, kind);
  const label = Math.max(13, Math.round(look.pad * 0.6));
  const byH = by ? label * 2.2 : 0;
  const size = fitSize(title, { width: box.w - look.pad * 2, lines, max: 150, min: 26, height: box.h - look.pad * 2 - label * 2 - byH, lineHeight: 0.95, charW: CHAR.sansBold });
  return (
    <Tile look={look} box={box} kind={kind}>
      <div style={{ ...row, alignItems: "center" }}>
        <div style={{ width: label * 0.6, height: label * 0.6, borderRadius: label, background: kind === "surface" ? visible(look.t.palette.accent, look.t.palette.surface, c.ink) : c.ink, marginRight: label * 0.5 }} />
        <Label size={label} color={c.ink}>
          {kicker}
        </Label>
      </div>
      <div style={{ ...col }}>
        <Big size={size} color={c.ink}>
          {title}
        </Big>
        {by ? (
          <T size={Math.round(label * 1.25)} weight={500} color={fade(c.ink, 0.75)} style={{ marginTop: label * 0.7 }}>
            {by}
          </T>
        ) : null}
      </div>
    </Tile>
  );
}

function TextTile({ look, box, label, text, kind = "card", size }: { look: Look; box: Box; label: string; text: string; kind?: Kind; size?: number }) {
  const c = paint(look.t, kind);
  const s = size ?? Math.max(16, Math.min(30, Math.round(box.w / 22)));
  const lines = Math.max(1, Math.floor((box.h - look.pad * 2 - s * 2) / (s * 1.32)));
  return (
    <Tile look={look} box={box} kind={kind}>
      <Label size={Math.max(13, Math.round(s * 0.6))} color={c.ink}>
        {label}
      </Label>
      <Clamp size={s} lines={lines} color={c.ink} lineHeight={1.32} weight={500}>
        {text}
      </Clamp>
    </Tile>
  );
}

function ScoreTile({ look, box, value, label }: { look: Look; box: Box; value: number; label: string }) {
  return (
    <Tile look={look} box={box} kind="score">
      <Label size={Math.max(12, Math.round(box.w * 0.08))} color="#FFFFFF">
        {label}
      </Label>
      <Big size={Math.min(box.h * 0.5, box.w * 0.42)} color="#FFFFFF">
        {value.toFixed(1)}
      </Big>
    </Tile>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Award and new listing
// ─────────────────────────────────────────────────────────────────────────────

function Site({ fr, t, c, shot, badge }: { fr: Frame; t: Theme; c: SiteContent; shot: string | null; badge: string | null }) {
  const look = lookOf(fr, t);
  const area = areaOf(fr, look.P);
  const G = look.G;
  const by = c.studio ? `by ${c.studio}` : undefined;
  const side = (box: Box) => {
    const [a, b] = split(box, "col", [1, 1], G);
    return (
      <>
        <AwardTile look={look} box={a} c={c} badge={badge} />
        {c.award || !c.tagline ? <DateTile look={look} box={b} date={c.date} /> : <TextTile look={look} box={b} label="In short" text={c.tagline} size={Math.max(14, Math.round(b.w / 20))} />}
      </>
    );
  };
  if (fr.shape === "wide") {
    const [left, right] = split(area, "row", [1.25, 1], G);
    const [top, mid, bottom] = split(right, "col", [2.1, 1, 1], G);
    const [m1, m2] = split(mid, "row", [1, 1], G);
    return (
      <Page W={fr.W} H={fr.H} background={t.palette.base}>
        <ShotTile look={look} box={left} src={shot} label={hostOf(c.url) || undefined} />
        <TitleTile look={look} box={top} kicker={c.kicker} title={c.title} by={by} lines={3} />
        <AwardTile look={look} box={m1} c={c} badge={badge} />
        {c.date ? <DateTile look={look} box={m2} date={c.date} /> : <UrlTile look={look} box={m2} url={c.url} kind="card" />}
        <BrandTile look={look} box={bottom} />
      </Page>
    );
  }
  const rows = { portrait: [6, 3.9, 2.2], square: [4.6, 3.3, 1.5], tall: [6.4, 4.2, 2.2] }[fr.shape];
  const [r1, r2, r3] = split(area, "col", rows, G);
  const [titleBox, sideBox] = split(r2, "row", [2, 1], G);
  const [brand, url] = split(r3, "row", [1, 1], G);
  return (
    <Page W={fr.W} H={fr.H} background={t.palette.base}>
      <ShotTile look={look} box={r1} src={shot} label={hostOf(c.url) || undefined} />
      <TitleTile look={look} box={titleBox} kicker={c.kicker} title={c.title} by={by} />
      {side(sideBox)}
      <BrandTile look={look} box={brand} />
      <UrlTile look={look} box={url} url={c.url} />
      <TallEdges fr={fr} t={t} P={look.P} right={c.kicker} />
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calls and announcements
// ─────────────────────────────────────────────────────────────────────────────

function CtaTile({ look, box, cta, label }: { look: Look; box: Box; cta: string; label: string }) {
  const c = paint(look.t, "accent");
  const disc = Math.round(Math.min(box.h - look.pad * 2, 104, box.w * 0.28));
  const size = fitSize(cta, { width: box.w - look.pad * 2 - disc - 20, lines: 2, max: Math.min(46, box.h * 0.3), min: 16, charW: CHAR.sansBold });
  return (
    <Tile look={look} box={box} kind="accent" style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <div style={{ ...col, height: "100%", justifyContent: "space-between", width: box.w - look.pad * 2 - disc - 20 }}>
        <Label size={Math.max(13, Math.round(size * 0.5))} color={c.ink}>
          {label}
        </Label>
        <Big size={size} color={c.ink} lead={1.02}>
          {cta}
        </Big>
      </div>
      <ArrowDisc size={disc} bg={c.ink} fg={c.bg} />
    </Tile>
  );
}

function Call({ fr, t, c, counter }: { fr: Frame; t: Theme; c: CallContent; counter?: string }) {
  const look = lookOf(fr, t);
  const area = areaOf(fr, look.P);
  const G = look.G;
  if (fr.shape === "wide") {
    const [left, right] = split(area, "row", [1.5, 1], G);
    const [body, cta] = split(right, "col", [1.6, 1], G);
    return (
      <Page W={fr.W} H={fr.H} background={t.palette.base}>
        <TitleTile look={look} box={left} kicker={c.kicker} title={c.headline} lines={4} />
        {c.body ? <TextTile look={look} box={body} label="Details" text={c.body} /> : <BrandTile look={look} box={body} />}
        <CtaTile look={look} box={cta} cta={c.cta || "shemoqmedi.space"} label="Go to" />
      </Page>
    );
  }
  const rows = { portrait: [6.4, 2.6, 2.2], square: [5, 2.4, 2], tall: [6.4, 2.6, 2.2] }[fr.shape];
  const [r1, r2, r3] = split(area, "col", rows, G);
  const [body, brand] = split(r2, "row", [2, 1], G);
  const [cta, count] = split(r3, "row", [2, 1], G);
  return (
    <Page W={fr.W} H={fr.H} background={t.palette.base}>
      <TitleTile look={look} box={r1} kicker={c.kicker} title={c.headline} lines={5} />
      {c.body ? <TextTile look={look} box={body} label="Details" text={c.body} /> : <BrandTile look={look} box={body} />}
      <BrandTile look={look} box={brand} note={counter ?? "Open now"} />
      <CtaTile look={look} box={cta} cta={c.cta || "shemoqmedi.space"} label="Go to" />
      <Tile look={look} box={count} kind="line">
        <Label size={Math.max(13, count.h * 0.1)} color={t.ink}>
          Reviewed
        </Label>
        {/* Two words that may wrap: fitted to the tile (padding and label taken off), never cut at its edge. */}
        <Big
          size={fitSize("By hand", {
            width: count.w - look.pad * 2,
            lines: 2,
            max: 140,
            min: 20,
            height: count.h - look.pad * 2 - Math.max(13, count.h * 0.1) * 1.6,
            lineHeight: 0.95,
            charW: CHAR.sansBold,
          })}
          color={t.ink}
        >
          By hand
        </Big>
      </Tile>
      <TallEdges fr={fr} t={t} P={look.P} right={c.kicker} />
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Jury quote
// ─────────────────────────────────────────────────────────────────────────────

function QuoteTile({ look, box, quote }: { look: Look; box: Box; quote: string }) {
  const c = paint(look.t, "surface");
  const mark = Math.round(Math.min(120, box.h * 0.2));
  const size = fitSize(quote, { width: box.w - look.pad * 2, lines: 8, max: 112, min: 20, height: box.h - look.pad * 2 - mark * 0.7, lineHeight: 1.12, charW: CHAR.sans });
  return (
    <Tile look={look} box={box} kind="surface" style={{ justifyContent: "flex-start" }}>
      <T size={mark} weight={700} color={visible(look.t.palette.accent, look.t.palette.surface, c.ink)} style={{ lineHeight: 0.8, height: mark * 0.62 }}>
        “
      </T>
      <div style={{ display: "flex", marginTop: mark * 0.1, fontSize: size, fontWeight: 600, lineHeight: 1.12, letterSpacing: -size * 0.025, color: c.ink }}>{quote}</div>
    </Tile>
  );
}

function Quote({ fr, t, c, pillars, counter }: { fr: Frame; t: Theme; c: QuoteContent; pillars?: [string, number][] | null; counter?: string }) {
  const look = lookOf(fr, t);
  const area = areaOf(fr, look.P);
  const G = look.G;
  const juror = (box: Box) => (
    <Tile look={look} box={box} kind="card">
      <Label size={Math.max(13, Math.round(look.pad * 0.5))} color={t.ink}>
        {counter ?? "The jury"}
      </Label>
      <div style={{ ...col }}>
        <T size={Math.min(40, Math.round(box.w / 12))} weight={700} color={t.ink} style={{ letterSpacing: -0.6 }}>
          {c.juror}
        </T>
        {c.role ? (
          <T size={Math.min(24, Math.round(box.w / 20))} weight={500} color={fade(t.ink, 0.7)} style={{ marginTop: 6 }}>
            {c.role}
          </T>
        ) : null}
      </div>
    </Tile>
  );
  if (fr.shape === "wide") {
    const [left, right] = split(area, "row", [1.7, 1], G);
    const [a, b] = split(right, "col", [1, 1], G);
    return (
      <Page W={fr.W} H={fr.H} background={t.palette.base}>
        <QuoteTile look={look} box={left} quote={c.quote} />
        {juror(a)}
        {c.score !== null ? <ScoreTile look={look} box={b} value={c.score} label="Jury score" /> : <TextTile look={look} box={b} label="On" text={c.site} kind="accent" />}
      </Page>
    );
  }
  const scores: [string, number][] = [...(c.score !== null ? ([["Jury score", c.score]] as [string, number][]) : []), ...(pillars ?? [])];
  const rows = { portrait: [6.2, 2.4, scores.length > 1 ? 2.2 : 0.0001], square: [5.2, 2.6, scores.length > 1 ? 2 : 0.0001], tall: [6.6, 2.4, scores.length > 1 ? 2.2 : 0.0001] }[fr.shape];
  const [r1, r2, r3] = split(area, "col", scores.length > 1 ? rows : rows.slice(0, 2), G);
  const [jBox, sBox] = split(r2, "row", [2, 1], G);
  return (
    <Page W={fr.W} H={fr.H} background={t.palette.base}>
      <QuoteTile look={look} box={r1} quote={c.quote} />
      {juror(jBox)}
      {scores.length === 1 ? (
        <ScoreTile look={look} box={sBox} value={scores[0][1]} label={scores[0][0]} />
      ) : (
        <Tile look={look} box={sBox} kind="accent">
          <Label size={Math.max(13, Math.round(look.pad * 0.5))} color={t.onAccent}>
            On
          </Label>
          <T size={Math.min(34, Math.round(sBox.w / 9))} weight={700} color={t.onAccent} style={{ letterSpacing: -0.6 }}>
            {c.site || "Shemoqmedi"}
          </T>
        </Tile>
      )}
      {scores.length > 1 && r3
        ? split(r3, "row", scores.map(() => 1), G).map((box, i) => <ScoreTile key={scores[i][0]} look={look} box={box} value={scores[i][1]} label={scores[i][0]} />)
        : null}
      <TallEdges fr={fr} t={t} P={look.P} right="The jury" />
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot slide
// ─────────────────────────────────────────────────────────────────────────────

function ShotPage({ fr, t, c, shot, tagline, counter }: { fr: Frame; t: Theme; c: ShotContent; shot: string | null; tagline?: string; counter?: string }) {
  const look = lookOf(fr, t);
  const area = areaOf(fr, look.P);
  const G = look.G;
  const index = counter ?? c.index;
  const indexTile = (box: Box) => (
    <Tile look={look} box={box} kind="accent">
      <Label size={Math.max(13, Math.round(look.pad * 0.5))} color={t.onAccent}>
        Slide
      </Label>
      <Big size={Math.min(box.h * 0.45, box.w / Math.max(2.4, index.length * 0.5))} color={t.onAccent}>
        {index || "01"}
      </Big>
    </Tile>
  );
  if (fr.shape === "wide") {
    const [left, right] = split(area, "row", [1.6, 1], G);
    const [a, b] = split(right, "col", [1.6, 1], G);
    return (
      <Page W={fr.W} H={fr.H} background={t.palette.base}>
        <ShotTile look={look} box={left} src={shot} label={hostOf(c.url) || undefined} />
        <TitleTile look={look} box={a} kicker={c.studio ? `by ${c.studio}` : "Shemoqmedi"} title={c.title} lines={3} />
        {indexTile(b)}
      </Page>
    );
  }
  const rows = { portrait: [7, 2.6, tagline ? 1.6 : 1.3], square: [5.4, 2.4, 1.3], tall: [7.4, 2.6, 1.6] }[fr.shape];
  const [r1, r2, r3] = split(area, "col", rows, G);
  const [titleBox, idx] = split(r2, "row", [2.3, 1], G);
  const [bottomL, bottomR] = split(r3, "row", [1.3, 1], G);
  return (
    <Page W={fr.W} H={fr.H} background={t.palette.base}>
      <ShotTile look={look} box={r1} src={shot} label={hostOf(c.url) || undefined} />
      <TitleTile look={look} box={titleBox} kicker={c.studio ? `by ${c.studio}` : "Shemoqmedi"} title={c.title} lines={2} />
      {indexTile(idx)}
      {tagline ? <TextTile look={look} box={bottomL} label="In short" text={tagline} size={20} /> : <BrandTile look={look} box={bottomL} />}
      <UrlTile look={look} box={bottomR} url={c.url} />
      <TallEdges fr={fr} t={t} P={look.P} right={c.index} />
    </Page>
  );
}

function single({ template, format, fields, theme, shot, badge }: SingleInput) {
  const fr = frameOf(format);
  const c = contentOf(template, fields);
  switch (c.kind) {
    case "site":
      return <Site fr={fr} t={theme} c={c} shot={shot} badge={badge} />;
    case "call":
      return <Call fr={fr} t={theme} c={c} />;
    case "quote":
      return <Quote fr={fr} t={theme} c={c} />;
    case "shot":
      return <ShotPage fr={fr} t={theme} c={c} shot={shot} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Carousel slides
// ─────────────────────────────────────────────────────────────────────────────

const SLIDE = frameOf("ig_portrait");
const DETAIL = { w: 1000, h: 760 };
const PHONE = { w: 420, h: 1270 };

function slide({ plan, index, facts: f, theme: t, assets: a }: SlideInput) {
  const kind = plan[index];
  const counter = `${pad2(index + 1)} / ${pad2(plan.length)}`;
  const look = lookOf(SLIDE, t);
  const area = areaOf(SLIDE, look.P);
  const G = look.G;
  const page = (children: ReactNode) => (
    <Page W={SLIDE.W} H={SLIDE.H} background={t.palette.base}>
      {children}
    </Page>
  );
  switch (kind) {
    case "hook": {
      const c = siteOfStory(f);
      const [r1, r2, r3] = split(area, "col", [5.4, 3.6, 1.6], G);
      const [award, date] = split(r2, "row", [1, 1], G);
      const [brand, count] = split(r3, "row", [2, 1], G);
      return page(
        <>
          <TitleTile look={look} box={r1} kicker={c.kicker} title={f.title} by={`by ${f.studio}`} lines={4} />
          <AwardTile look={look} box={award} c={c} badge={a.badge} />
          <DateTile look={look} box={date} date={f.date} />
          <BrandTile look={look} box={brand} />
          <Tile look={look} box={count} kind="line">
            <Label size={14} color={t.ink}>
              Swipe
            </Label>
            <Big size={40} color={t.ink}>
              {counter}
            </Big>
          </Tile>
        </>,
      );
    }
    case "site":
      return <ShotPage fr={SLIDE} t={t} c={{ kind: "shot", title: hostOf(f.url) || f.title, studio: f.studio, url: f.url, index: "" }} shot={a.hero} tagline={f.tagline} counter={pad2(index + 1)} />;
    case "detail": {
      const d = detailIndex(plan, index);
      const [r1, r2] = split(area, "col", [{ px: DETAIL.h }, 1], G);
      const [chip, note] = split(r2, "row", [1, 2], G);
      return page(
        <>
          <At x={r1.x} y={r1.y} w={r1.w} h={r1.h} style={{ borderRadius: look.radius, overflow: "hidden" }}>
            <Shot src={a.details[d] ?? null} w={r1.w} h={r1.h} fallback={t.palette.surface} radius={look.radius} />
          </At>
          <Tile look={look} box={chip} kind="accent">
            <Label size={15} color={t.onAccent}>
              {`Up close · ${counter}`}
            </Label>
            <Big size={fitSize(chipOf(f, d), { width: chip.w - look.pad * 2, lines: 2, max: 64, min: 24, charW: CHAR.sansBold })} color={t.onAccent}>
              {chipOf(f, d)}
            </Big>
          </Tile>
          <TitleTile look={look} box={note} kicker={f.title} title={f.notes[d] || "Every detail, considered."} lines={3} />
        </>,
      );
    }
    case "mobile": {
      const [left, right] = split(area, "row", [{ px: PHONE.w }, 1], G);
      const [r1, r2, r3] = split(right, "col", [3, 1.2, 1.2], G);
      return page(
        <>
          <At x={left.x} y={left.y} w={left.w} h={left.h} style={{ borderRadius: look.radius, overflow: "hidden" }}>
            <Shot src={a.mobile} w={left.w} h={left.h} fallback={t.palette.surface} radius={look.radius} />
          </At>
          <TitleTile look={look} box={r1} kicker={SECTION.mobile} title="Made for the thumb." lines={4} />
          <UrlTile look={look} box={r2} url={f.url} kind="card" />
          <BrandTile look={look} box={r3} kind="line" note={counter} />
        </>,
      );
    }
    case "jury": {
      const pillars: [string, number][] | null = f.pillars
        ? [
            ["Design", f.pillars.design],
            ["Usability", f.pillars.usability],
            ["Creativity", f.pillars.creativity],
            ["Content", f.pillars.content],
          ]
        : null;
      return (
        <Quote
          fr={SLIDE}
          t={t}
          c={{ kind: "quote", quote: f.quote.replace(/^["“]|["”]$/g, "") || `${f.title}, scored by the jury.`, juror: f.juror || "The jury", role: f.role, site: f.title, score: f.score }}
          pillars={pillars}
          counter={counter}
        />
      );
    }
    case "credits": {
      const [r1, r2, r3] = split(area, "col", [3, 3, 2], G);
      const [cat, web] = split(r3, "row", [1, 1], G);
      const chips = (
        <div style={{ ...row, flexWrap: "wrap" }}>
          {f.tech.slice(0, 8).map((tech) => (
            <div key={tech} style={{ ...row, height: 64, padding: "0 26px", marginRight: 12, marginBottom: 12, alignItems: "center", borderRadius: 40, background: t.palette.base }}>
              <T size={26} weight={600} color={t.ink}>
                {tech}
              </T>
            </div>
          ))}
        </div>
      );
      return page(
        <>
          <TitleTile look={look} box={r1} kicker={`Credits · ${counter}`} title={f.studio} lines={2} />
          <Tile look={look} box={r2} kind="card">
            <Label size={16} color={t.ink}>
              Built with
            </Label>
            {chips}
          </Tile>
          <TextTile look={look} box={cat} label="Category" text={f.categories.join(", ") || "Website"} kind="line" size={30} />
          <UrlTile look={look} box={web} url={f.url} kind="accent" label="Website" />
        </>,
      );
    }
    case "cta":
      return <Call fr={SLIDE} t={t} c={{ kind: "call", kicker: "See it", headline: f.ctaHeadline, body: `The full review, every screenshot and the jury's scores live at ${f.link}.`, cta: f.link.split("/")[0] || "shemoqmedi.space" }} counter={counter} />;
  }
}

function shotWidth(format: FormatId) {
  return format === "link" ? 800 : 1100;
}

export const bento: FlatStyle = {
  single,
  slide,
  shotWidth,
  slidePictures: { hero: 1100, detail: () => ({ w: DETAIL.w, h: DETAIL.h, zoom: 1.8 }), mobile: PHONE.w * 1.5 },
  grain: false,
};
