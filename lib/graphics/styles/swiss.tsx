/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { ReactNode } from "react";
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

// Swiss editorial. The International Typographic Style, straight: a strict
// 12-column grid, one huge grotesk headline set tight and flush left, hairline
// rules, numbers as structure, and white space doing the rest. The palette's
// surface is one big asymmetric field (bleeding off the page) that holds the
// screenshot in a hairline frame; the accent is a single small square.

type Grid = { M: number; gutter: number; colW: number; meta: number; x: (c: number) => number; span: (a: number, b: number) => number };

function gridOf(fr: Frame): Grid {
  const M = fr.shape === "wide" ? 40 : fr.shape === "square" ? 56 : 64;
  const gutter = fr.shape === "wide" ? 14 : 20;
  const colW = (fr.W - M * 2 - gutter * 11) / 12;
  const x = (c: number) => Math.round(M + (c - 1) * (colW + gutter));
  return {
    M,
    gutter,
    colW,
    meta: fr.shape === "wide" ? 15 : fr.shape === "square" ? 19 : 21,
    x,
    span: (a, b) => Math.round((b - a + 1) * colW + (b - a) * gutter),
  };
}

const TRACK = -0.052;
const LEAD = 0.9;

/** The headline: Inter Bold, tight, flush left, ragged right. */
function Headline({ size, color, children }: { size: number; color: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", fontSize: size, fontWeight: 700, lineHeight: LEAD, letterSpacing: size * TRACK, color }}>
      {children}
    </div>
  );
}

/** Top of every Swiss page: a heavy rule, then three cells on the grid (cols 1–4, 5–8, 9–12). */
function MetaBar({ g, y, ink, cells, accent }: { g: Grid; y: number; ink: string; cells: [string, string, string]; accent: string }) {
  const cell = (text: string, c: number, i: number) => (
    <div key={i} style={{ ...row, position: "absolute", left: g.x(c) - g.M, top: 0, width: g.span(c, c + 3), alignItems: "center", justifyContent: i === 2 ? "flex-end" : "flex-start" }}>
      {i === 1 && text ? <div style={{ width: g.meta * 0.62, height: g.meta * 0.62, background: accent, marginRight: g.meta * 0.6 }} /> : null}
      <T size={g.meta} weight={i === 0 ? 700 : 500} color={ink} style={{ letterSpacing: i === 0 ? g.meta * 0.02 : -g.meta * 0.01 }}>
        {text}
      </T>
    </div>
  );
  return (
    <At x={g.M} y={y} w={g.span(1, 12)}>
      <div style={{ height: g.meta > 18 ? 3 : 2, background: ink }} />
      <div style={{ display: "flex", position: "relative", height: g.meta * 1.4, marginTop: g.meta * 0.7 }}>{cells.map((t, i) => cell(t, 1 + i * 4, i))}</div>
    </At>
  );
}

/** A label above a value, under a hairline (the info column and the credits table). */
function Field({ label, value, ink, size, w }: { label: string; value: ReactNode; ink: string; size: number; w: number }) {
  return (
    <div style={{ ...col, width: w, paddingTop: size * 0.55, marginTop: size * 0.7, borderTop: `1px solid ${fade(ink, 0.35)}` }}>
      <T size={size * 0.72} weight={500} color={fade(ink, 0.6)}>
        {label}
      </T>
      <div style={{ display: "flex", marginTop: size * 0.25, fontSize: size, fontWeight: 600, letterSpacing: -size * 0.015, color: ink, maxWidth: w, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        {value}
      </div>
    </div>
  );
}

/** A screenshot in a hairline frame. */
function Framed({ src, x, y, w, h, line, fallback, radius = 0 }: { src: string | null; x: number; y: number; w: number; h: number; line: string; fallback: string; radius?: number }) {
  return (
    <At x={x} y={y} w={w} h={h} style={{ border: `1.5px solid ${line}`, borderRadius: radius, overflow: "hidden" }}>
      <Shot src={src} w={w - 3} h={h - 3} fallback={fallback} radius={Math.max(0, radius - 1.5)} />
    </At>
  );
}

function ScoreSquare({ x, y, size, value, label }: { x: number; y: number; size: number; value: string; label: string }) {
  return (
    <At x={x} y={y} w={size} h={size} style={{ background: SCORE_BLUE, padding: size * 0.1, justifyContent: "space-between" }}>
      <T size={size * 0.085} weight={600} color="rgba(255,255,255,0.82)">
        {label}
      </T>
      <T size={size * 0.38} weight={700} color="#FFFFFF" style={{ letterSpacing: -size * 0.02, lineHeight: 0.9 }}>
        {value}
      </T>
    </At>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Award and new listing
// ─────────────────────────────────────────────────────────────────────────────

function Site({ fr, t, c, shot, badge, cells }: { fr: Frame; t: Theme; c: SiteContent; shot: string | null; badge: string | null; cells?: [string, string, string] }) {
  const g = gridOf(fr);
  const p = t.palette;
  const meta = cells ?? ["Shemoqmedi", c.kicker, c.award ? c.date : "New listing"];

  if (fr.shape === "wide") {
    const leftW = g.span(1, 6);
    const size = fitSize(c.title, { width: leftW, lines: 3, max: 92, min: 34, height: 300, lineHeight: LEAD, charW: CHAR.sansBold });
    const bx = g.x(7) + g.gutter;
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <At x={g.M} y={g.M} w={leftW}>
          <div style={{ height: 2, background: t.ink }} />
          <div style={{ ...row, marginTop: 12, alignItems: "center", justifyContent: "space-between" }}>
            <T size={15} weight={700} color={t.ink}>
              {meta[0]}
            </T>
            <div style={{ ...row, alignItems: "center" }}>
              <div style={{ width: 10, height: 10, background: p.accent, marginRight: 10 }} />
              <T size={15} weight={500} color={t.ink}>
                {c.kicker}
              </T>
            </div>
          </div>
        </At>
        <At x={g.M} y={120} w={leftW} h={fr.H - 120 - 110} style={{ justifyContent: "flex-end" }}>
          <Headline size={size} color={t.ink}>
            {c.title}
          </Headline>
        </At>
        <At x={g.M} y={fr.H - g.M - 46} w={leftW} style={{ ...row, justifyContent: "space-between", alignItems: "flex-end" }}>
          <T size={20} weight={500} color={t.ink}>
            {c.studio ? `by ${c.studio}` : hostOf(c.url)}
          </T>
          <T size={15} weight={500} color={fade(t.ink, 0.6)}>
            {c.date || hostOf(c.url)}
          </T>
        </At>
        <At x={bx} y={0} w={fr.W - bx} h={fr.H} style={{ background: p.surface }} />
        <Framed src={shot} x={bx + 32} y={g.M} w={fr.W - bx - 32 - g.M} h={fr.H - g.M * 2} line={t.onSurface} fallback={fade(t.onSurface, 0.1)} />
      </Page>
    );
  }

  const geo = {
    portrait: { meta: 64, titleTop: 150, block: 720 },
    square: { meta: 56, titleTop: 130, block: 560 },
    tall: { meta: 236, titleTop: 330, block: 1040 },
  }[fr.shape];
  const width = g.span(1, 12);
  const studioH = c.tagline ? 140 : c.studio ? 64 : 0;
  const titleBottom = geo.block - 52 - studioH;
  const size = fitSize(c.title, {
    width,
    lines: 4,
    max: fr.shape === "tall" ? 200 : fr.shape === "portrait" ? 176 : 150,
    min: 52,
    height: titleBottom - geo.titleTop,
    lineHeight: LEAD,
    charW: CHAR.sansBold,
  });
  const bx = g.x(5);
  const infoW = g.span(1, 4) - 8;
  const pad = 40;
  const shotBottom = fr.shape === "tall" ? fr.safe.bottom : fr.H - g.M;
  const badgeSize = fr.shape === "square" ? 150 : 200;
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <MetaBar g={g} y={geo.meta} ink={t.ink} cells={meta} accent={p.accent} />
      <At x={g.M} y={geo.titleTop} w={width} h={titleBottom - geo.titleTop} style={{ justifyContent: "flex-end" }}>
        <Headline size={size} color={t.ink}>
          {c.title}
        </Headline>
      </At>
      <At x={bx} y={titleBottom + 24} w={g.span(5, 12)}>
        {c.tagline ? (
          <Clamp size={fr.shape === "square" ? 24 : 28} lines={3} color={t.ink} lineHeight={1.3}>
            {c.tagline}
          </Clamp>
        ) : c.studio ? (
          <T size={fr.shape === "square" ? 30 : 36} weight={500} color={t.ink} style={{ letterSpacing: -0.6 }}>
            {`by ${c.studio}`}
          </T>
        ) : null}
      </At>
      <At x={g.M} y={geo.block} w={infoW}>
        <Field label="Studio" value={c.studio || "Independent"} ink={t.ink} size={fr.shape === "square" ? 22 : 26} w={infoW} />
        {c.date ? <Field label="Date" value={c.date} ink={t.ink} size={fr.shape === "square" ? 22 : 26} w={infoW} /> : null}
        {c.url && fr.shape !== "square" ? <Field label="Website" value={hostOf(c.url)} ink={t.ink} size={22} w={infoW} /> : null}
      </At>
      <At x={g.M} y={shotBottom - badgeSize} w={infoW}>
        {badge && c.award ? (
          <img src={badge} width={badgeSize} height={badgeSize} style={{ width: badgeSize, height: badgeSize }} />
        ) : (
          <T size={badgeSize * 0.62} weight={700} color={visible(p.accent, p.base, t.ink)} style={{ letterSpacing: -badgeSize * 0.04, lineHeight: 0.8 }}>
            {c.award ? tierMark(c.tier) : "New"}
          </T>
        )}
      </At>
      <At x={bx} y={geo.block} w={fr.W - bx} h={fr.H - geo.block} style={{ background: p.surface }} />
      <Framed src={shot} x={bx + pad} y={geo.block + pad} w={fr.W - bx - pad - g.M} h={shotBottom - geo.block - pad} line={t.onSurface} fallback={fade(t.onSurface, 0.1)} />
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calls and announcements
// ─────────────────────────────────────────────────────────────────────────────

function Call({ fr, t, c, cells }: { fr: Frame; t: Theme; c: CallContent; cells?: [string, string, string] }) {
  const g = gridOf(fr);
  const p = t.palette;
  const meta = cells ?? ["Shemoqmedi", c.kicker, "shemoqmedi.space"];
  const ctaRow = (size: number, w: number) =>
    c.cta ? (
      <div style={{ ...row, alignItems: "center", marginTop: size * 1.2, width: w }}>
        <div style={{ ...row, width: size * 1.9, height: size * 1.9, background: p.accent, alignItems: "center", justifyContent: "center", marginRight: size * 0.7 }}>
          <Arrow size={size * 1.1} color={t.onAccent} weight={2.2} />
        </div>
        <T size={size} weight={600} color={t.onSurface} style={{ letterSpacing: -size * 0.01 }}>
          {c.cta}
        </T>
      </div>
    ) : null;

  if (fr.shape === "wide") {
    const leftW = g.span(1, 7);
    const bx = g.x(8) + g.gutter;
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <At x={g.M} y={g.M} w={leftW}>
          <div style={{ height: 2, background: t.ink }} />
          <div style={{ ...row, marginTop: 12, alignItems: "center" }}>
            <div style={{ width: 10, height: 10, background: p.accent, marginRight: 10 }} />
            <T size={15} weight={700} color={t.ink}>
              {c.kicker}
            </T>
          </div>
        </At>
        <At x={g.M} y={110} w={leftW} h={fr.H - 110 - g.M} style={{ justifyContent: "flex-end" }}>
          <Headline size={fitSize(c.headline, { width: leftW, lines: 4, max: 84, min: 32, height: fr.H - 110 - g.M, lineHeight: LEAD, charW: CHAR.sansBold })} color={t.ink}>
            {c.headline}
          </Headline>
        </At>
        <At x={bx} y={0} w={fr.W - bx} h={fr.H} style={{ background: p.surface, padding: `${g.M}px ${g.M}px ${g.M}px 32px`, justifyContent: "space-between" }}>
          <T size={15} weight={700} color={t.onSurface}>
            Shemoqmedi
          </T>
          <div style={{ ...col }}>
            {c.body ? (
              <Clamp size={21} lines={6} color={t.onSurface} lineHeight={1.34}>
                {c.body}
              </Clamp>
            ) : null}
            {ctaRow(19, fr.W - bx - 32 - g.M)}
          </div>
        </At>
      </Page>
    );
  }

  const geo = {
    portrait: { meta: 64, top: 150, band: 860, body: 32, cta: 28 },
    square: { meta: 56, top: 130, band: 660, body: 28, cta: 25 },
    tall: { meta: 236, top: 330, band: 1160, body: 36, cta: 30 },
  }[fr.shape];
  const width = g.span(1, 12);
  const size = fitSize(c.headline, {
    width,
    lines: 5,
    max: fr.shape === "tall" ? 230 : fr.shape === "portrait" ? 210 : 176,
    min: 56,
    height: geo.band - 56 - geo.top,
    lineHeight: LEAD,
    charW: CHAR.sansBold,
  });
  const bodyX = g.x(5);
  const bodyW = g.span(5, 12);
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <MetaBar g={g} y={geo.meta} ink={t.ink} cells={meta} accent={p.accent} />
      <At x={g.M} y={geo.top} w={width}>
        <Headline size={size} color={t.ink}>
          {c.headline}
        </Headline>
      </At>
      <At x={0} y={geo.band} w={fr.W} h={fr.H - geo.band} style={{ background: p.surface }} />
      <At x={g.M} y={geo.band + 40} w={g.span(1, 4)}>
        <T size={geo.body * 0.8} weight={700} color={t.onSurface}>
          {c.kicker}
        </T>
      </At>
      <At x={bodyX} y={geo.band + 40} w={bodyW}>
        {c.body ? (
          <Clamp size={geo.body} lines={fr.shape === "square" ? 4 : 5} color={t.onSurface} lineHeight={1.3} style={{ letterSpacing: -geo.body * 0.01 }}>
            {c.body}
          </Clamp>
        ) : null}
        {ctaRow(geo.cta, bodyW)}
      </At>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Jury quote
// ─────────────────────────────────────────────────────────────────────────────

function Quote({ fr, t, c, pillars, cells }: { fr: Frame; t: Theme; c: QuoteContent; pillars?: [string, number][] | null; cells?: [string, string, string] }) {
  const g = gridOf(fr);
  const p = t.palette;
  const meta = cells ?? ["Shemoqmedi", "The jury", c.site];
  const wide = fr.shape === "wide";
  const geo = wide
    ? { meta: g.M, top: 96, band: 452, q: 64 }
    : { portrait: { meta: 64, top: 160, band: 900, q: 104 }, square: { meta: 56, top: 140, band: 730, q: 88 }, tall: { meta: 236, top: 340, band: 1190, q: 112 } }[fr.shape as "portrait" | "square" | "tall"];
  // The hanging quotation mark gets its own column, so it never touches the first word.
  const markW = wide ? 64 : 124;
  const textX = g.M + markW;
  const textW = fr.W - textX - g.M;
  const size = fitSize(c.quote, { width: textW, lines: wide ? 5 : 8, max: geo.q, min: 24, height: geo.band - geo.top - 48, lineHeight: 1.12, charW: CHAR.sans });
  const scoreSize = wide ? 140 : fr.shape === "square" ? 180 : 220;
  const hasPillars = !!pillars && !wide;
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      {wide ? (
        <At x={g.M} y={g.M} w={fr.W - g.M * 2}>
          <div style={{ height: 2, background: t.ink }} />
        </At>
      ) : (
        <MetaBar g={g} y={geo.meta} ink={t.ink} cells={meta} accent={p.accent} />
      )}
      <At x={g.M} y={geo.top - size * 0.1}>
        <T size={Math.min(size * 2.2, markW * 1.7)} weight={700} color={visible(p.accent, p.base, t.ink)} style={{ lineHeight: 0.8 }}>
          “
        </T>
      </At>
      <At x={textX} y={geo.top} w={textW}>
        <div style={{ display: "flex", fontSize: size, fontWeight: 500, lineHeight: 1.12, letterSpacing: -size * 0.022, color: t.ink }}>{c.quote}</div>
      </At>
      <At x={0} y={geo.band} w={fr.W} h={fr.H - geo.band} style={{ background: p.surface }} />
      <At x={g.M} y={geo.band + (wide ? 28 : 44)} w={wide ? 520 : g.span(1, 7)}>
        <T size={wide ? 22 : 34} weight={700} color={t.onSurface} style={{ letterSpacing: -0.5 }}>
          {c.juror}
        </T>
        {c.role ? (
          <T size={wide ? 16 : 24} weight={500} color={fade(t.onSurface, 0.7)} style={{ marginTop: 6 }}>
            {c.role}
          </T>
        ) : null}
        {c.site && !hasPillars ? (
          <T size={wide ? 16 : 24} weight={500} color={t.onSurface} style={{ marginTop: wide ? 14 : 28 }}>
            {`On ${c.site}`}
          </T>
        ) : null}
      </At>
      {hasPillars
        ? [...(c.score !== null ? ([["Jury score", c.score]] as [string, number][]) : []), ...pillars!].map(([label, value], i, all) => {
            const s = (fr.W - g.M * 2 - (all.length - 1) * 12) / all.length;
            return <ScoreSquare key={label} x={g.M + i * (s + 12)} y={fr.H - (fr.shape === "tall" ? 240 : g.M) - s} size={s} value={value.toFixed(1)} label={label} />;
          })
        : null}
      {c.score !== null && !hasPillars ? (
        <ScoreSquare
          x={fr.W - g.M - scoreSize}
          y={geo.band + (wide ? 24 : 40)}
          size={scoreSize}
          value={c.score.toFixed(1)}
          label="Jury score"
        />
      ) : null}
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot slide (and the carousel's site slide)
// ─────────────────────────────────────────────────────────────────────────────

function ShotPage({ fr, t, c, shot, tagline, cells }: { fr: Frame; t: Theme; c: ShotContent; shot: string | null; tagline?: string; cells?: [string, string, string] }) {
  const g = gridOf(fr);
  const p = t.palette;
  const meta = cells ?? ["Shemoqmedi", c.studio ? `by ${c.studio}` : hostOf(c.url), c.index];
  if (fr.shape === "wide") {
    const w = g.span(1, 8);
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <At x={0} y={fr.H * 0.55} w={fr.W} h={fr.H * 0.45} style={{ background: p.surface }} />
        <Framed src={shot} x={g.M} y={g.M} w={w} h={fr.H - g.M * 2} line={t.ink} fallback={fade(t.ink, 0.08)} />
        <At x={g.x(9) + g.gutter} y={g.M} w={g.span(9, 12) - g.gutter}>
          <div style={{ height: 2, background: t.ink, marginBottom: 12 }} />
          <T size={15} weight={700} color={t.ink}>
            {c.index || "Shemoqmedi"}
          </T>
        </At>
        <At x={g.x(9) + g.gutter} y={fr.H * 0.55 + 28} w={g.span(9, 12) - g.gutter}>
          <Headline size={fitSize(c.title, { width: g.span(9, 12) - g.gutter, lines: 3, max: 44, min: 22, charW: CHAR.sansBold })} color={t.onSurface}>
            {c.title}
          </Headline>
          {c.studio ? (
            <T size={16} weight={500} color={t.onSurface} style={{ marginTop: 10 }}>
              {`by ${c.studio}`}
            </T>
          ) : null}
        </At>
      </Page>
    );
  }
  const geo = { portrait: { meta: 64, y: 160, band: 560 }, square: { meta: 56, y: 140, band: 440 }, tall: { meta: 236, y: 340, band: 860 } }[fr.shape];
  const w = g.span(1, 12);
  const h = Math.round(w / 1.55);
  const capY = geo.y + h + 40;
  const size = fitSize(c.title, { width: w, lines: 2, max: fr.shape === "square" ? 72 : 96, min: 36, charW: CHAR.sansBold });
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <MetaBar g={g} y={geo.meta} ink={t.ink} cells={meta} accent={p.accent} />
      <At x={0} y={geo.band} w={fr.W} h={fr.H - geo.band} style={{ background: p.surface }} />
      <Framed src={shot} x={g.M} y={geo.y} w={w} h={h} line={t.ink} fallback={fade(t.ink, 0.08)} />
      <At x={g.M} y={capY} w={w}>
        <Headline size={size} color={t.onSurface}>
          {c.title}
        </Headline>
      </At>
      <At x={g.x(5)} y={capY + size * 2 * LEAD + 24} w={g.span(5, 12)}>
        {tagline ? (
          <Clamp size={28} lines={3} color={t.onSurface} lineHeight={1.3}>
            {tagline}
          </Clamp>
        ) : c.url ? (
          <T size={26} weight={500} color={t.onSurface}>
            {hostOf(c.url)}
          </T>
        ) : null}
      </At>
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
// Carousel slides (1080×1350)
// ─────────────────────────────────────────────────────────────────────────────

const SLIDE = frameOf("ig_portrait");
const DETAIL = { w: 952, h: 640 };
const PHONE = { w: 380, h: 822 };

function slide({ plan, index, facts: f, theme: t, assets: a }: SlideInput) {
  const kind = plan[index];
  const counter = `${pad2(index + 1)} / ${pad2(plan.length)}`;
  const cells: [string, string, string] = ["Shemoqmedi", SECTION[kind] || f.kicker, counter];
  const g = gridOf(SLIDE);
  const p = t.palette;
  switch (kind) {
    case "hook": {
      const c = siteOfStory(f);
      const [day, ...rest] = (f.date || "").split(" ");
      const size = fitSize(f.title, { width: g.span(1, 12), lines: 4, max: 190, min: 60, height: 560, lineHeight: LEAD, charW: CHAR.sansBold });
      const bx = g.x(5);
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <MetaBar g={g} y={64} ink={t.ink} cells={["Shemoqmedi", c.kicker, counter]} accent={p.accent} />
          <At x={g.M} y={150} w={g.span(1, 12)} h={560} style={{ justifyContent: "flex-end" }}>
            <Headline size={size} color={t.ink}>
              {f.title}
            </Headline>
          </At>
          <At x={bx} y={740} w={g.span(5, 12)}>
            <T size={36} weight={500} color={t.ink} style={{ letterSpacing: -0.6 }}>
              {`by ${f.studio}`}
            </T>
          </At>
          <At x={bx} y={840} w={SLIDE.W - bx} h={SLIDE.H - 840} style={{ background: p.surface, padding: "40px 64px 64px 40px", justifyContent: "flex-end" }}>
            {day ? (
              <div style={{ ...row, alignItems: "flex-end" }}>
                <T size={300} weight={700} color={t.onSurface} style={{ letterSpacing: -18, lineHeight: 0.78 }}>
                  {day}
                </T>
                <div style={{ ...col, marginLeft: 24, marginBottom: 4 }}>
                  {rest.map((part) => (
                    <T key={part} size={34} weight={600} color={t.onSurface}>
                      {part}
                    </T>
                  ))}
                </div>
              </div>
            ) : (
              <T size={200} weight={700} color={t.onSurface} style={{ letterSpacing: -10 }}>
                {tierMark(c.tier)}
              </T>
            )}
          </At>
          <At x={g.M} y={SLIDE.H - 64 - 230} w={g.span(1, 4)}>
            {a.badge ? (
              <img src={a.badge} width={230} height={230} style={{ width: 230, height: 230 }} />
            ) : (
              <T size={30} weight={700} color={t.ink}>
                {f.tier in TIERS ? TIERS[f.tier as keyof typeof TIERS] : "New"}
              </T>
            )}
          </At>
        </Page>
      );
    }
    case "site":
      return <ShotPage fr={SLIDE} t={t} c={{ kind: "shot", title: hostOf(f.url) || f.title, studio: f.studio, url: f.url, index: counter }} shot={a.hero} tagline={f.tagline} cells={cells} />;
    case "detail": {
      const d = detailIndex(plan, index);
      const note = f.notes[d] ?? "";
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <MetaBar g={g} y={64} ink={t.ink} cells={cells} accent={p.accent} />
          <At x={0} y={760} w={SLIDE.W} h={SLIDE.H - 760} style={{ background: p.surface }} />
          <Framed src={a.details[d] ?? null} x={g.M} y={160} w={DETAIL.w} h={DETAIL.h} line={t.ink} fallback={fade(t.ink, 0.08)} />
          <At x={g.M} y={160 + DETAIL.h + 24} w={g.span(1, 4)}>
            <T size={22} weight={600} color={t.onSurface}>
              {`Fig. ${pad2(d + 1)}`}
            </T>
          </At>
          <At x={g.x(5)} y={160 + DETAIL.h + 24} w={g.span(5, 12)}>
            <T size={22} weight={600} color={t.onSurface}>
              {chipOf(f, d)}
            </T>
            {note ? (
              <Clamp size={46} lines={4} color={t.onSurface} weight={600} lineHeight={1.1} style={{ marginTop: 28, letterSpacing: -1.4 }}>
                {note}
              </Clamp>
            ) : null}
          </At>
        </Page>
      );
    }
    case "mobile":
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <MetaBar g={g} y={64} ink={t.ink} cells={cells} accent={p.accent} />
          <At x={g.x(6) - 20} y={0} w={SLIDE.W - g.x(6) + 20} h={SLIDE.H} style={{ background: p.surface }} />
          <Framed src={a.mobile} x={g.M} y={200} w={PHONE.w} h={PHONE.h} line={t.ink} fallback={fade(t.ink, 0.08)} radius={46} />
          <At x={g.x(7)} y={640} w={g.span(7, 12)}>
            <Headline size={92} color={t.onSurface}>
              Made for the thumb.
            </Headline>
            <T size={24} weight={500} color={t.onSurface} style={{ marginTop: 32 }}>
              {hostOf(f.url)}
            </T>
          </At>
        </Page>
      );
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
          cells={cells}
        />
      );
    }
    case "credits": {
      const w = g.span(5, 12);
      const line = (label: string, value: string, i: number) => (
        <div key={label} style={{ ...row, paddingTop: 22, paddingBottom: 22, borderTop: `${i === 0 ? 3 : 1}px solid ${i === 0 ? t.ink : fade(t.ink, 0.4)}` }}>
          <div style={{ ...row, width: g.span(1, 4) + g.gutter }}>
            <T size={24} weight={500} color={fade(t.ink, 0.65)}>
              {label}
            </T>
          </div>
          <Clamp size={36} lines={3} color={t.ink} weight={600} lineHeight={1.18} style={{ width: w, letterSpacing: -0.8 }}>
            {value}
          </Clamp>
        </div>
      );
      const rows = [
        ["Studio", f.studio],
        ["Built with", f.tech.slice(0, 7).join(", ")],
        ["Category", f.categories.join(", ")],
        ["Website", hostOf(f.url)],
      ].filter(([, value]) => value);
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <MetaBar g={g} y={64} ink={t.ink} cells={cells} accent={p.accent} />
          <At x={g.M} y={160} w={g.span(1, 12)}>
            <Headline size={fitSize(f.studio, { width: g.span(1, 12), lines: 2, max: 150, min: 60, charW: CHAR.sansBold })} color={t.ink}>
              {f.studio}
            </Headline>
          </At>
          <At x={0} y={SLIDE.H - 520} w={SLIDE.W} h={520} style={{ background: p.surface }} />
          <At x={g.M} y={SLIDE.H - 520 - rows.length * 110 + 40} w={g.span(1, 12)} style={{ background: p.base, paddingBottom: 20 }}>
            {rows.map(([label, value], i) => line(label, value, i))}
          </At>
          <At x={g.M} y={SLIDE.H - 64 - 40} w={g.span(1, 12)} style={{ ...row, justifyContent: "space-between" }}>
            <T size={24} weight={600} color={t.onSurface}>
              {f.link}
            </T>
            <T size={24} weight={600} color={t.onSurface}>
              {counter}
            </T>
          </At>
        </Page>
      );
    }
    case "cta":
      return <Call fr={SLIDE} t={t} c={{ kind: "call", kicker: f.kicker, headline: f.ctaHeadline, body: `${f.link}. Made something you're proud of? Submit it at shemoqmedi.space/submit.`, cta: "shemoqmedi.space" }} cells={cells} />;
  }
}

function shotWidth(format: FormatId) {
  return format === "link" ? 900 : 1200;
}

export const swiss: FlatStyle = {
  single,
  slide,
  shotWidth,
  slidePictures: { hero: 1200, detail: () => ({ w: DETAIL.w, h: DETAIL.h, zoom: 1.9 }), mobile: PHONE.w * 1.5 },
  grain: false,
};
