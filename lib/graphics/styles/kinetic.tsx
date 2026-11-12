/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { FormatId } from "../spec";
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
  stackWords,
  visible,
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
} from "./common";

// Kinetic typography. The words are the picture: the title is broken into
// stacked lines, each set in capitals at whatever size fills the width, solid
// and outlined in turn and cropped by the edges as if still moving. A ticker
// tape in the surface colour runs across the frame; the screenshot comes in
// as a tilted card that interrupts the type. Static frames, made to read as
// stills from a motion piece (they double as reel covers).

const LEAD = 0.84;
const TRACK = -0.035;

/** Advance widths of Inter Bold capitals, in em (rounded; enough to fill a line edge to edge). */
const CAP_WIDTHS: Record<string, number> = { I: 0.3, J: 0.55, L: 0.56, F: 0.6, E: 0.62, T: 0.64, S: 0.66, P: 0.68, B: 0.7, Z: 0.66, A: 0.74, K: 0.72, R: 0.7, V: 0.74, X: 0.72, Y: 0.72, C: 0.74, G: 0.77, D: 0.75, H: 0.77, N: 0.77, U: 0.76, O: 0.8, Q: 0.8, M: 0.92, W: 1.02, " ": 0.26 };

/** Width of `text` in capitals at 1 px, with the display tracking. */
function capsWidth(text: string) {
  let w = 0;
  for (const ch of text) w += (CAP_WIDTHS[ch] ?? (/\d/.test(ch) ? 0.66 : /[\p{L}]/u.test(ch) ? 0.7 : 0.34)) + TRACK;
  return Math.max(0.5, w);
}

type Line = { text: string; size: number; outline: boolean; shift: number };

/**
 * The stacked lines of `text` for a block `width` wide and at most `height`
 * tall: each line set at the size that fills the width, alternately solid
 * and outlined, every other line nudged off the left edge. Tries every line
 * count up to `maxLines`, scales each down to the height, and keeps the one
 * whose smallest line is biggest (no tiny line under a huge one).
 */
function stack(text: string, width: number, height: number, maxLines = 4, maxSize = 360): Line[] {
  const upper = text.toUpperCase();
  let best: { words: string[]; sizes: number[]; least: number; total: number } | null = null;
  for (let n = 1; n <= maxLines; n++) {
    const words = stackWords(upper, n);
    if (words.length < n && best) break;
    const natural = words.map((w) => Math.min(maxSize, Math.floor(width / capsWidth(w))));
    const k = Math.min(1, height / natural.reduce((sum, size) => sum + size * LEAD, 0));
    const sizes = natural.map((size) => Math.floor(size * k));
    const least = Math.min(...sizes);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (!best || least > best.least || (least === best.least && total > best.total)) best = { words, sizes, least, total };
  }
  return best!.words.map((w, i) => {
    const size = best!.sizes[i];
    return { text: w, size, outline: i % 2 === 1, shift: i % 2 === 1 && best!.words.length > 1 ? -Math.round(size * 0.06) : 0 };
  });
}

/**
 * One line of display capitals. Outlined lines are filled with the ground
 * colour and stroked twice as wide: satori paints the stroke under the fill
 * (and skips transparent text altogether), so half the stroke shows.
 */
function Word({ line, ink, stroke, ground }: { line: Line; ink: string; stroke: number; ground: string }) {
  return (
    <div
      style={{
        display: "flex",
        marginLeft: line.shift,
        fontSize: line.size,
        fontWeight: 700,
        lineHeight: LEAD,
        letterSpacing: line.size * TRACK,
        whiteSpace: "nowrap",
        color: line.outline ? ground : ink,
        ...(line.outline ? { WebkitTextStroke: `${stroke * 2}px ${ink}` } : {}),
      }}
    >
      {line.text}
    </div>
  );
}

function Stack({ lines, ink, ground }: { lines: Line[]; ink: string; ground: string }) {
  return (
    <div style={{ ...col }}>
      {lines.map((l, i) => (
        <Word key={i} line={l} ink={ink} ground={ground} stroke={Math.max(2, Math.round(l.size * 0.022))} />
      ))}
    </div>
  );
}

/** An eight-point asterisk: the kinetic style's mark, in the accent. */
function Star({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 0v24M0 12h24M3.5 3.5l17 17M20.5 3.5l-17 17" stroke={color} strokeWidth="3.6" />
    </svg>
  );
}

/** A tape of repeated words across the frame, tilted, in the surface colour. */
function Ticker({ t, y, words, size, angle = -4, W }: { t: Theme; y: number; words: string[]; size: number; angle?: number; W: number }) {
  const unit = words.map((w) => w.toUpperCase());
  const items = [...unit, ...unit, ...unit, ...unit].slice(0, 12);
  const h = Math.round(size * 2.1);
  return (
    <At x={-80} y={y} w={W + 160} h={h} style={{ ...row, alignItems: "center", background: t.palette.surface, transform: `rotate(${angle}deg)`, overflow: "hidden" }}>
      {items.map((w, i) => (
        <div key={i} style={{ ...row, alignItems: "center", flexShrink: 0 }}>
          <T size={size} weight={700} color={t.onSurface} style={{ letterSpacing: size * 0.02, whiteSpace: "nowrap", marginLeft: size * 0.8 }}>
            {w}
          </T>
          <div style={{ display: "flex", marginLeft: size * 0.8 }}>
            <Star size={size * 0.8} color={visible(t.palette.accent, t.palette.surface, t.onSurface)} />
          </div>
        </div>
      ))}
    </At>
  );
}

/** The screenshot as a tilted card with a heavy ink edge. */
function Card({ src, x, y, w, h, angle, t }: { src: string | null; x: number; y: number; w: number; h: number; angle: number; t: Theme }) {
  const b = Math.max(4, Math.round(w * 0.008));
  return (
    <At x={x} y={y} w={w} h={h} style={{ transform: `rotate(${angle}deg)`, border: `${b}px solid ${t.ink}`, background: t.ink }}>
      <Shot src={src} w={w - b * 2} h={h - b * 2} fallback={t.palette.surface} />
    </At>
  );
}

function Foot({ fr, t, left, right, y }: { fr: Frame; t: Theme; left: string; right: string; y?: number }) {
  const M = fr.shape === "wide" ? 40 : 64;
  const size = fr.shape === "wide" ? 16 : 24;
  return (
    <At x={M} y={y ?? fr.safe.bottom - M - size} w={fr.W - M * 2} style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
      <T size={size} weight={700} color={t.ink} style={{ letterSpacing: size * 0.04 }}>
        {left.toUpperCase()}
      </T>
      <T size={size} weight={500} color={t.ink}>
        {right}
      </T>
    </At>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Award and new listing
// ─────────────────────────────────────────────────────────────────────────────

function Site({ fr, t, c, shot, badge, counter }: { fr: Frame; t: Theme; c: SiteContent; shot: string | null; badge: string | null; counter?: string }) {
  const p = t.palette;
  const tape = [c.kicker, c.studio || "Shemoqmedi", c.date || "shemoqmedi.space"].filter(Boolean);
  if (fr.shape === "wide") {
    const lines = stack(c.title, 640, 420, 3, 200);
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <At x={40} y={70} w={680}>
          <Stack lines={lines} ink={t.ink} ground={p.base} />
        </At>
        <Card src={shot} x={700} y={110} w={540} h={340} angle={5} t={t} />
        <Ticker t={t} y={490} words={tape} size={20} angle={-3} W={fr.W} />
        <At x={40} y={28} w={fr.W - 80} style={{ ...row, justifyContent: "space-between" }}>
          <T size={16} weight={700} color={t.ink} style={{ letterSpacing: 0.6 }}>
            SHEMOQMEDI
          </T>
          <div style={{ ...row, alignItems: "center" }}>
            <Star size={16} color={p.accent} />
            <T size={16} weight={700} color={t.ink} style={{ marginLeft: 10, letterSpacing: 0.6 }}>
              {c.kicker.toUpperCase()}
            </T>
          </div>
        </At>
      </Page>
    );
  }
  const geo = {
    portrait: { top: 120, stackH: 640, ticker: 760, card: { x: 300, y: 860, w: 700, h: 420 } },
    square: { top: 104, stackH: 470, ticker: 590, card: { x: 380, y: 680, w: 600, h: 340 } },
    tall: { top: 300, stackH: 760, ticker: 1080, card: { x: 260, y: 1180, w: 760, h: 470 } },
  }[fr.shape];
  const lines = stack(c.title, fr.W - 100, geo.stackH, 4);
  const badgeSize = fr.shape === "square" ? 190 : 230;
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <At x={64} y={fr.shape === "tall" ? fr.safe.top - 40 : 52} w={fr.W - 128} style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
        <T size={22} weight={700} color={t.ink} style={{ letterSpacing: 1 }}>
          SHEMOQMEDI
        </T>
        <div style={{ ...row, alignItems: "center" }}>
          <Star size={22} color={p.accent} />
          <T size={22} weight={700} color={t.ink} style={{ marginLeft: 12, letterSpacing: 1 }}>
            {counter ?? c.kicker.toUpperCase()}
          </T>
        </div>
      </At>
      <At x={40} y={geo.top} w={fr.W}>
        <Stack lines={lines} ink={t.ink} ground={p.base} />
      </At>
      <Card src={shot} x={geo.card.x} y={geo.card.y} w={geo.card.w} h={geo.card.h} angle={-4} t={t} />
      <Ticker t={t} y={geo.ticker} words={tape} size={fr.shape === "square" ? 24 : 28} W={fr.W} />
      <At x={64} y={geo.card.y + 30} w={geo.card.x - 100}>
        {badge && c.award ? (
          <img src={badge} width={badgeSize} height={badgeSize} style={{ width: badgeSize, height: badgeSize, transform: "rotate(-10deg)" }} />
        ) : (
          <div style={{ ...col }}>
            <T size={fr.shape === "square" ? 110 : 140} weight={700} color={p.accent} style={{ letterSpacing: -6, lineHeight: 0.85 }}>
              {c.award ? tierMark(c.tier) : "NEW"}
            </T>
          </div>
        )}
      </At>
      {c.tagline && fr.shape !== "square" ? (
        <At x={64} y={geo.card.y + 30 + (fr.shape === "tall" ? 160 : 140)} w={geo.card.x - 110}>
          <Clamp size={22} lines={fr.shape === "tall" ? 6 : 4} color={t.ink} lineHeight={1.3} weight={500}>
            {c.tagline}
          </Clamp>
        </At>
      ) : null}
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calls and announcements
// ─────────────────────────────────────────────────────────────────────────────

function CtaButton({ t, text, size }: { t: Theme; text: string; size: number }) {
  return (
    <div style={{ ...row, alignItems: "center", height: size * 2.6, padding: `0 ${size * 1.1}px`, background: t.palette.accent, borderRadius: size * 1.3 }}>
      <T size={size} weight={700} color={t.onAccent} style={{ letterSpacing: size * 0.02 }}>
        {text.toUpperCase()}
      </T>
      <div style={{ display: "flex", marginLeft: size * 0.7 }}>
        <Arrow size={size * 1.3} color={t.onAccent} weight={2.4} />
      </div>
    </div>
  );
}

function Call({ fr, t, c, counter }: { fr: Frame; t: Theme; c: CallContent; counter?: string }) {
  const p = t.palette;
  if (fr.shape === "wide") {
    const lines = stack(c.headline, 760, 470, 4, 180);
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <At x={40} y={40} w={800}>
          <Stack lines={lines} ink={t.ink} ground={p.base} />
        </At>
        <At x={860} y={0} w={340} h={fr.H} style={{ background: p.surface, padding: 36, justifyContent: "space-between" }}>
          <div style={{ ...row, alignItems: "center" }}>
            <Star size={18} color={p.accent} />
            <T size={16} weight={700} color={t.onSurface} style={{ marginLeft: 10, letterSpacing: 0.6 }}>
              {c.kicker.toUpperCase()}
            </T>
          </div>
          <div style={{ ...col }}>
            {c.body ? (
              <Clamp size={20} lines={6} color={t.onSurface} lineHeight={1.32} weight={500}>
                {c.body}
              </Clamp>
            ) : null}
            {c.cta ? (
              <div style={{ display: "flex", marginTop: 22 }}>
                <CtaButton t={t} text={c.cta} size={14} />
              </div>
            ) : null}
          </div>
        </At>
      </Page>
    );
  }
  const geo = {
    portrait: { top: 140, stackH: 760, band: 960 },
    square: { top: 120, stackH: 560, band: 740 },
    tall: { top: 320, stackH: 900, band: 1300 },
  }[fr.shape];
  const lines = stack(c.headline, fr.W - 100, geo.stackH, 6);
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <Ticker t={t} y={fr.shape === "tall" ? fr.safe.top - 120 : -14} words={[c.kicker, "Shemoqmedi"]} size={24} angle={0} W={fr.W} />
      <At x={40} y={geo.top} w={fr.W}>
        <Stack lines={lines} ink={t.ink} ground={p.base} />
      </At>
      <At x={64} y={geo.band} w={fr.W - 128}>
        <div style={{ height: 4, background: t.ink, marginBottom: 28 }} />
        <div style={{ ...row, justifyContent: "space-between", alignItems: "flex-start" }}>
          {c.body ? (
            <Clamp size={fr.shape === "square" ? 26 : 30} lines={4} color={t.ink} lineHeight={1.28} weight={500} style={{ width: fr.W - 128 - (c.cta ? 0 : 0) }}>
              {c.body}
            </Clamp>
          ) : null}
        </div>
        {c.cta ? (
          <div style={{ display: "flex", marginTop: 32 }}>
            <CtaButton t={t} text={c.cta} size={fr.shape === "square" ? 20 : 24} />
          </div>
        ) : null}
      </At>
      {counter ? <Foot fr={fr} t={t} left="Shemoqmedi" right={counter} /> : null}
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Jury quote
// ─────────────────────────────────────────────────────────────────────────────

function Quote({ fr, t, c, pillars, counter }: { fr: Frame; t: Theme; c: QuoteContent; pillars?: [string, number][] | null; counter?: string }) {
  const p = t.palette;
  const wide = fr.shape === "wide";
  const M = wide ? 40 : 64;
  const top = wide ? 40 : fr.shape === "tall" ? fr.safe.top + 20 : 64;
  const nameH = wide ? 150 : fr.shape === "square" ? 230 : 300;
  const nameY = (fr.shape === "tall" ? fr.safe.bottom : fr.H) - nameH - (wide ? 10 : 30);
  const scoreS = wide ? 130 : 200;
  const hasScore = c.score !== null && !pillars;
  const quoteW = fr.W - M * 2 - (wide && hasScore ? scoreS + 30 : 0);
  const quoteH = nameY - top - (wide ? 70 : 140) - (pillars && !wide ? 220 : 0) - (hasScore && !wide ? scoreS * 0.8 : 0);
  const size = fitSize(c.quote, { width: quoteW, lines: 9, max: wide ? 52 : fr.shape === "square" ? 84 : 104, min: 22, height: quoteH, lineHeight: 1.08, charW: CHAR.sansBold });
  const name = stack(c.juror || "The jury", fr.W + 40, nameH, 1, 400)[0];
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <At x={M} y={top}>
        <T size={wide ? 90 : 170} weight={700} color={p.accent} style={{ lineHeight: 0.8 }}>
          “
        </T>
      </At>
      <At x={M} y={top + (wide ? 64 : 128)} w={quoteW}>
        <div style={{ display: "flex", fontSize: size, fontWeight: 700, lineHeight: 1.08, letterSpacing: size * -0.03, color: t.ink }}>{c.quote}</div>
        <T size={wide ? 16 : 24} weight={600} color={fade(t.ink, 0.7)} style={{ marginTop: wide ? 14 : 28 }}>
          {[c.role, c.site ? `on ${c.site}` : ""].filter(Boolean).join(" · ")}
        </T>
      </At>
      {pillars && !wide ? (
        <At x={M} y={nameY - 230} w={fr.W - M * 2} style={{ ...row, justifyContent: "space-between" }}>
          {pillars.map(([label, value]) => (
            <div key={label} style={{ ...col, width: 200, height: 200, background: SCORE_BLUE, padding: 18, justifyContent: "space-between" }}>
              <T size={20} weight={700} color="#FFFFFF" style={{ letterSpacing: 0.6 }}>
                {label.toUpperCase()}
              </T>
              <T size={84} weight={700} color="#FFFFFF" style={{ letterSpacing: -4, lineHeight: 0.9 }}>
                {value.toFixed(1)}
              </T>
            </div>
          ))}
        </At>
      ) : null}
      <At x={-20} y={nameY} w={fr.W + 80}>
        <Word line={{ ...name, outline: true, shift: 0 }} ink={t.ink} ground={p.base} stroke={Math.max(2, Math.round(name.size * 0.02))} />
      </At>
      {c.score !== null && !pillars ? (
        <At
          x={fr.W - M - scoreS}
          y={wide ? 40 : nameY - scoreS * 0.85}
          w={scoreS}
          h={scoreS}
          style={{ background: SCORE_BLUE, padding: scoreS * 0.1, justifyContent: "space-between", transform: "rotate(6deg)" }}
        >
          <T size={scoreS * 0.09} weight={700} color="#FFFFFF" style={{ letterSpacing: 1 }}>
            JURY SCORE
          </T>
          <T size={scoreS * 0.42} weight={700} color="#FFFFFF" style={{ letterSpacing: -scoreS * 0.02, lineHeight: 0.9 }}>
            {c.score.toFixed(1)}
          </T>
        </At>
      ) : null}
      {counter ? <Foot fr={fr} t={t} left="Shemoqmedi" right={counter} y={30} /> : null}
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot slide
// ─────────────────────────────────────────────────────────────────────────────

function ShotPage({ fr, t, c, shot, tagline }: { fr: Frame; t: Theme; c: ShotContent; shot: string | null; tagline?: string }) {
  const p = t.palette;
  const index = (c.index.split("/")[0] || "").trim();
  if (fr.shape === "wide") {
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <At x={0} y={0} w={760} h={fr.H}>
          <Shot src={shot} w={760} h={fr.H} fallback={p.surface} />
        </At>
        <At x={800} y={40} w={360} h={fr.H - 80} style={{ justifyContent: "space-between" }}>
          <T size={16} weight={700} color={t.ink} style={{ letterSpacing: 0.6 }}>
            SHEMOQMEDI
          </T>
          <Stack lines={stack(c.title, 360, 300, 4, 120)} ink={t.ink} ground={p.base} />
        </At>
        {index ? (
          <At x={30} y={fr.H - 210}>
            <Word line={{ text: pad2(Number(index) || 1), size: 260, outline: false, shift: 0 }} ink={p.accent} ground={p.base} stroke={0} />
          </At>
        ) : null}
      </Page>
    );
  }
  const geo = { portrait: { shotH: 760, stackH: 380 }, square: { shotH: 560, stackH: 300 }, tall: { shotH: 980, stackH: 420 } }[fr.shape];
  const shotY = fr.shape === "tall" ? fr.safe.top : 0;
  const lines = stack(c.title, fr.W - 100, geo.stackH, 3);
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <At x={0} y={shotY} w={fr.W} h={geo.shotH}>
        <Shot src={shot} w={fr.W} h={geo.shotH} fallback={p.surface} />
      </At>
      {index ? (
        <At x={fr.W - 420} y={shotY + geo.shotH - 250}>
          <Word line={{ text: pad2(Number(index) || 1), size: 360, outline: false, shift: 0 }} ink={p.accent} ground={p.base} stroke={0} />
        </At>
      ) : null}
      <At x={40} y={shotY + geo.shotH + 40} w={fr.W}>
        <Stack lines={lines} ink={t.ink} ground={p.base} />
        {tagline ? (
          <Clamp size={26} lines={3} color={t.ink} weight={500} lineHeight={1.3} style={{ marginTop: 28, width: fr.W - 128, marginLeft: 24 }}>
            {tagline}
          </Clamp>
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
// Carousel slides
// ─────────────────────────────────────────────────────────────────────────────

const SLIDE = frameOf("ig_portrait");
const DETAIL = { w: 1080, h: 820 };
const PHONE = { w: 420, h: 900 };

function Section({ t, kind, counter }: { t: Theme; kind: string; counter: string }) {
  return (
    <At x={64} y={52} w={SLIDE.W - 128} style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ ...row, alignItems: "center" }}>
        <Star size={22} color={t.palette.accent} />
        <T size={22} weight={700} color={t.ink} style={{ marginLeft: 12, letterSpacing: 1 }}>
          {kind.toUpperCase()}
        </T>
      </div>
      <T size={22} weight={700} color={t.ink} style={{ letterSpacing: 1 }}>
        {counter}
      </T>
    </At>
  );
}

function slide({ plan, index, facts: f, theme: t, assets: a }: SlideInput) {
  const kind = plan[index];
  const counter = `${pad2(index + 1)}/${pad2(plan.length)}`;
  const p = t.palette;
  switch (kind) {
    case "hook": {
      const c = siteOfStory(f);
      const lines = stack(f.title, SLIDE.W - 100, 700, 4);
      const [day, ...rest] = (f.date || "").split(" ");
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <Section t={t} kind={c.kicker} counter={counter} />
          <At x={40} y={130} w={SLIDE.W}>
            <Stack lines={lines} ink={t.ink} ground={p.base} />
          </At>
          <Ticker t={t} y={880} words={[c.kicker, `by ${f.studio}`]} size={28} W={SLIDE.W} />
          <At x={64} y={1010} w={SLIDE.W - 128} style={{ ...row, justifyContent: "space-between", alignItems: "flex-end" }}>
            {a.badge ? <img src={a.badge} width={250} height={250} style={{ width: 250, height: 250, transform: "rotate(-10deg)" }} /> : <div style={{ display: "flex" }} />}
            {day ? (
              <div style={{ ...row, alignItems: "flex-end" }}>
                <T size={250} weight={700} color={p.accent} style={{ letterSpacing: -14, lineHeight: 0.8 }}>
                  {day}
                </T>
                <div style={{ ...col, marginLeft: 18 }}>
                  {rest.map((part) => (
                    <T key={part} size={34} weight={700} color={t.ink} style={{ letterSpacing: 1 }}>
                      {part.toUpperCase()}
                    </T>
                  ))}
                </div>
              </div>
            ) : null}
          </At>
        </Page>
      );
    }
    case "site":
      return <ShotPage fr={SLIDE} t={t} c={{ kind: "shot", title: hostOf(f.url) || f.title, studio: f.studio, url: f.url, index: "" }} shot={a.hero} tagline={f.tagline} />;
    case "detail": {
      const d = detailIndex(plan, index);
      const chip = stack(chipOf(f, d), SLIDE.W + 60, 260, 1, 300)[0];
      const note = f.notes[d] ?? "";
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <At x={0} y={0} w={DETAIL.w} h={DETAIL.h}>
            <Shot src={a.details[d] ?? null} w={DETAIL.w} h={DETAIL.h} fallback={p.surface} />
          </At>
          <At x={-24} y={DETAIL.h - chip.size * 0.5} w={SLIDE.W + 80}>
            <Word line={{ ...chip, outline: false, shift: 0 }} ink={p.accent} ground={p.base} stroke={0} />
          </At>
          {note ? (
            <At x={64} y={DETAIL.h + chip.size * 0.55} w={SLIDE.W - 128}>
              <Clamp size={44} lines={3} color={t.ink} weight={700} lineHeight={1.08} style={{ letterSpacing: -1.4 }}>
                {note}
              </Clamp>
            </At>
          ) : null}
          <Foot fr={SLIDE} t={t} left={`Up close ${pad2(d + 1)}`} right={counter} />
        </Page>
      );
    }
    case "mobile": {
      const lines = stack("Made for the thumb", 560, 760, 4, 220);
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <Section t={t} kind={SECTION.mobile} counter={counter} />
          <At x={40} y={200} w={600}>
            <Stack lines={lines} ink={t.ink} ground={p.base} />
          </At>
          <Card src={a.mobile} x={600} y={300} w={PHONE.w} h={PHONE.h} angle={6} t={t} />
        </Page>
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
      if (!f.quote && f.score !== null) {
        return (
          <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
            <Section t={t} kind="Jury score" counter={counter} />
            <At x={20} y={160} w={SLIDE.W}>
              <Word line={{ text: f.score.toFixed(1), size: 560, outline: false, shift: 0 }} ink={t.ink} ground={p.base} stroke={0} />
            </At>
          </Page>
        );
      }
      return (
        <Quote
          fr={SLIDE}
          t={t}
          c={{ kind: "quote", quote: f.quote.replace(/^["“]|["”]$/g, ""), juror: f.juror || "The jury", role: f.role, site: f.title, score: f.score }}
          pillars={pillars}
          counter={counter}
        />
      );
    }
    case "credits": {
      const lines = stack(f.studio, SLIDE.W - 100, 420, 3, 260);
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <Section t={t} kind={SECTION.credits} counter={counter} />
          <At x={40} y={140} w={SLIDE.W}>
            <Stack lines={lines} ink={t.ink} ground={p.base} />
          </At>
          {f.tech.length ? <Ticker t={t} y={640} words={f.tech} size={34} angle={-3} W={SLIDE.W} /> : null}
          <At x={64} y={800} w={SLIDE.W - 128}>
            {f.categories.length ? (
              <div style={{ ...col, marginBottom: 40 }}>
                <T size={22} weight={700} color={fade(t.ink, 0.6)} style={{ letterSpacing: 1 }}>
                  CATEGORY
                </T>
                <T size={56} weight={700} color={t.ink} style={{ marginTop: 10, letterSpacing: -2 }}>
                  {f.categories.join(" / ")}
                </T>
              </div>
            ) : null}
            <T size={22} weight={700} color={fade(t.ink, 0.6)} style={{ letterSpacing: 1 }}>
              WEBSITE
            </T>
            <T size={56} weight={700} color={t.ink} style={{ marginTop: 10, letterSpacing: -2 }}>
              {hostOf(f.url)}
            </T>
          </At>
        </Page>
      );
    }
    case "cta":
      return <Call fr={SLIDE} t={t} c={{ kind: "call", kicker: "See it", headline: f.ctaHeadline, body: f.link, cta: "shemoqmedi.space" }} counter={counter} />;
  }
}

function shotWidth(format: FormatId) {
  return format === "link" ? 900 : 1200;
}

export const kinetic: FlatStyle = {
  single,
  slide,
  shotWidth,
  slidePictures: { hero: 1300, detail: () => ({ w: DETAIL.w, h: DETAIL.h, zoom: 2 }), mobile: PHONE.w * 1.5 },
  grain: true,
};
