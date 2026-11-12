/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { ReactNode } from "react";
import type { FormatId } from "../spec";
import { TIERS } from "../spec";
import {
  At,
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

// Magazine. A print cover: the nameplate set huge in Instrument Serif across
// the top, an issue line above it and a double rule below, the screenshot as
// the cover picture on a band of the surface colour, cover lines in serif
// with an italic turn, a sticker roundel in the accent and a barcode at the
// foot. Inside pages use columns, folios and figure captions. Paper grain.

const SERIF = "Instrument Serif";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "12 Nov 2026" → its day of the year as the issue number, and "November 2026". */
function issueOf(date: string) {
  const ms = Date.parse(`${date} UTC`);
  if (!date || !Number.isFinite(ms)) return { no: "Special issue", month: "Shemoqmedi.space" };
  const d = new Date(ms);
  const day = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
  return { no: `No. ${String(day).padStart(3, "0")}`, month: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}

/** Accent text only where it reads against the base; otherwise the ink. */
function accentOn(t: Theme) {
  return visible(t.palette.accent, t.palette.base, t.ink);
}

function Caps({ size, color, children, style }: { size: number; color: string; children: ReactNode; style?: object }) {
  return (
    <T size={size} weight={600} color={color} style={{ letterSpacing: size * 0.16, textTransform: "uppercase", ...style }}>
      {children}
    </T>
  );
}

function Serif({ size, color, italic, children, lead = 0.95, style }: { size: number; color: string; italic?: boolean; children: ReactNode; lead?: number; style?: object }) {
  return (
    <div style={{ display: "flex", fontFamily: SERIF, fontStyle: italic ? "italic" : "normal", fontWeight: 400, fontSize: size, lineHeight: lead, letterSpacing: -size * 0.012, color, ...style }}>
      {children}
    </div>
  );
}

/** The cover's top: issue line, nameplate filling the width, double rule. */
function Masthead({ x, y, w, t, date, size, kicker }: { x: number; y: number; w: number; t: Theme; date: string; size?: number; kicker?: string }) {
  const issue = issueOf(date);
  const plate = size ?? Math.floor(w / (10 * 0.43));
  const small = Math.max(13, Math.round(plate * 0.075));
  return (
    <At x={x} y={y} w={w}>
      <div style={{ ...row, justifyContent: "space-between", alignItems: "center" }}>
        <Caps size={small} color={t.ink}>
          {`Vol. 1 · ${issue.no}`}
        </Caps>
        <Caps size={small} color={t.ink}>
          {kicker ?? "The web, reviewed by hand"}
        </Caps>
        <Caps size={small} color={t.ink}>
          {issue.month}
        </Caps>
      </div>
      <Serif size={plate} color={t.ink} lead={0.86} style={{ marginTop: plate * 0.06, letterSpacing: -plate * 0.02 }}>
        Shemoqmedi
      </Serif>
      <div style={{ height: 3, background: t.ink, marginTop: plate * 0.04 }} />
      <div style={{ height: 1, background: t.ink, marginTop: 4 }} />
    </At>
  );
}

/** The accent roundel stuck on the cover picture, tilted. */
function Sticker({ x, y, d, t, badge, line1, line2 }: { x: number; y: number; d: number; t: Theme; badge: string | null; line1: string; line2: string }) {
  if (badge) {
    return (
      <At x={x} y={y} w={d} h={d} style={{ transform: "rotate(-10deg)" }}>
        <img src={badge} width={d} height={d} style={{ width: d, height: d }} />
      </At>
    );
  }
  return (
    <At x={x} y={y} w={d} h={d} style={{ borderRadius: d, background: t.palette.accent, alignItems: "center", justifyContent: "center", transform: "rotate(-10deg)" }}>
      <Serif size={d * 0.2} color={t.onAccent} italic lead={1}>
        {line1}
      </Serif>
      <Caps size={d * 0.075} color={t.onAccent} style={{ marginTop: d * 0.05 }}>
        {line2}
      </Caps>
    </At>
  );
}

/** A decorative barcode, drawn from the text so every cover has its own. */
function Barcode({ x, y, w, h, color, seed }: { x: number; y: number; w: number; h: number; color: string; seed: string }) {
  const bars: number[] = [];
  let n = 7;
  for (const ch of seed.padEnd(24, "shemoqmedi")) {
    n = (n * 31 + ch.charCodeAt(0)) % 9973;
    bars.push(1 + (n % 4));
  }
  const unit = w / bars.reduce((a, b) => a + b + 1.4, 0);
  return (
    <At x={x} y={y} w={w} h={h} style={{ ...row, alignItems: "stretch" }}>
      {bars.map((b, i) => (
        <div key={i} style={{ width: b * unit, marginRight: 1.4 * unit, background: color }} />
      ))}
    </At>
  );
}

/** Two columns from one text (split at the word nearest the middle). */
function Columns({ text, size, color, w, lines, gap = 28 }: { text: string; size: number; color: string; w: number; lines: number; gap?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  const half = Math.ceil(words.length / 2);
  const colW = (w - gap) / 2;
  return (
    <div style={{ ...row, width: w, justifyContent: "space-between" }}>
      {[words.slice(0, half).join(" "), words.slice(half).join(" ")].map((part, i) => (
        <Clamp key={i} size={size} lines={lines} color={color} lineHeight={1.38} style={{ width: colW }}>
          {part}
        </Clamp>
      ))}
    </div>
  );
}

function Foot({ x, y, w, t, left, right, seed }: { x: number; y: number; w: number; t: Theme; left: string; right: string; seed: string }) {
  return (
    <>
      <At x={x} y={y} w={w - 190}>
        <div style={{ height: 1, background: t.ink, marginBottom: 14 }} />
        <div style={{ ...row, justifyContent: "space-between" }}>
          <Caps size={15} color={t.ink}>
            {left}
          </Caps>
          <Caps size={15} color={t.ink}>
            {right}
          </Caps>
        </div>
      </At>
      <Barcode x={x + w - 160} y={y - 6} w={160} h={44} color={t.ink} seed={seed} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The cover (award and new listing)
// ─────────────────────────────────────────────────────────────────────────────

function Cover({ fr, t, c, shot, badge }: { fr: Frame; t: Theme; c: SiteContent; shot: string | null; badge: string | null }) {
  const p = t.palette;
  const kicker = c.award ? `Cover story · ${c.kicker}` : c.kicker;
  const sticker = c.award ? { a: TIERS[c.tier].split(" ").slice(-1)[0], b: c.tier === "F100" ? "Honorary" : "Award" } : { a: "New", b: "This week" };
  if (fr.shape === "wide") {
    const leftW = 600;
    const bx = 680;
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <Masthead x={40} y={32} w={leftW} t={t} date={c.date} />
        <At x={40} y={250} w={leftW}>
          <Caps size={14} color={accentOn(t)}>
            {kicker}
          </Caps>
          <Serif size={fitSize(c.title, { width: leftW, lines: 2, max: 76, min: 36, charW: CHAR.serif })} color={t.ink} style={{ marginTop: 14 }}>
            {c.title}
          </Serif>
          {c.studio ? (
            <Serif size={30} color={t.ink} italic style={{ marginTop: 10 }}>
              {`by ${c.studio}`}
            </Serif>
          ) : null}
        </At>
        <Foot x={40} y={fr.H - 70} w={leftW - 130} t={t} left="shemoqmedi.space" right={c.date} seed={c.title} />
        <At x={bx} y={0} w={fr.W - bx} h={fr.H} style={{ background: p.surface }} />
        <At x={bx + 36} y={36} w={fr.W - bx - 72} h={fr.H - 72}>
          <Shot src={shot} w={fr.W - bx - 72} h={fr.H - 72} fallback={fade(t.onSurface, 0.1)} />
        </At>
        <Sticker x={bx - 90} y={fr.H - 220} d={170} t={t} badge={c.award ? badge : null} line1={sticker.a} line2={sticker.b} />
      </Page>
    );
  }
  const geo = {
    portrait: { M: 56, top: 44, band: [318, 860] as const, sticker: 210, title: 116, lines: 2 },
    square: { M: 48, top: 36, band: [272, 640] as const, sticker: 170, title: 92, lines: 2 },
    tall: { M: 56, top: 236, band: [512, 1150] as const, sticker: 230, title: 124, lines: 3 },
  }[fr.shape];
  const w = fr.W - geo.M * 2;
  const [b0, b1] = geo.band;
  const inset = fr.shape === "square" ? 24 : 32;
  const textTop = b1 + (fr.shape === "square" ? 26 : 36);
  const footY = (fr.shape === "tall" ? fr.safe.bottom : fr.H) - geo.M - 30;
  const columns = c.tagline && fr.shape !== "square";
  const size = fitSize(c.title, { width: w, lines: geo.lines, max: geo.title, min: 44, charW: CHAR.serif });
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <Masthead x={geo.M} y={geo.top} w={w} t={t} date={c.date} />
      <At x={0} y={b0} w={fr.W} h={b1 - b0} style={{ background: p.surface }} />
      <At x={geo.M} y={b0 + inset} w={w} h={b1 - b0 - inset * 2}>
        <Shot src={shot} w={w} h={b1 - b0 - inset * 2} fallback={fade(t.onSurface, 0.1)} />
      </At>
      <Sticker x={fr.W - geo.M - geo.sticker + 24} y={b1 - geo.sticker * 0.62} d={geo.sticker} t={t} badge={c.award ? badge : null} line1={sticker.a} line2={sticker.b} />
      <At x={geo.M} y={textTop} w={w - (fr.shape === "square" ? 0 : geo.sticker * 0.3)}>
        <Caps size={fr.shape === "square" ? 14 : 17} color={accentOn(t)}>
          {kicker}
        </Caps>
        <Serif size={size} color={t.ink} style={{ marginTop: 14 }}>
          {c.title}
        </Serif>
        {c.studio ? (
          <Serif size={Math.round(size * 0.4)} color={t.ink} italic style={{ marginTop: 8 }}>
            {`by ${c.studio}`}
          </Serif>
        ) : null}
        {columns ? (
          <div style={{ display: "flex", marginTop: 26 }}>
            <Columns text={c.tagline} size={21} color={t.ink} w={w} lines={fr.shape === "tall" ? 5 : 3} />
          </div>
        ) : null}
      </At>
      <Foot x={geo.M} y={footY} w={w} t={t} left="shemoqmedi.space" right={c.date || hostOf(c.url)} seed={c.title} />
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calls and announcements: the editor's letter
// ─────────────────────────────────────────────────────────────────────────────

/** The headline in roman with its last words turned italic (the editorial flourish). */
function Turned({ text, size, color }: { text: string; size: number; color: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  const cut = Math.max(1, words.length - Math.max(1, Math.round(words.length / 3)));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", fontFamily: SERIF, fontSize: size, lineHeight: 0.98, letterSpacing: -size * 0.012, color }}>
      {words.map((word, i) => (
        <span key={i} style={{ fontStyle: i >= cut ? "italic" : "normal", marginRight: size * 0.22 }}>
          {word}
        </span>
      ))}
    </div>
  );
}

function Letter({ fr, t, c, folio }: { fr: Frame; t: Theme; c: CallContent; folio?: string }) {
  const p = t.palette;
  const drop = (c.body || " ").trim()[0] ?? "";
  const rest = (c.body || "").trim().slice(1);
  const body = (size: number, w: number) =>
    c.body ? (
      <div style={{ ...row, width: w }}>
        <Serif size={size * 2.9} color={t.onSurface} lead={0.8} style={{ marginRight: size * 0.4, marginTop: size * 0.12 }}>
          {drop}
        </Serif>
        <Clamp size={size} lines={5} color={t.onSurface} lineHeight={1.38} style={{ width: w - size * 2.6 }}>
          {rest}
        </Clamp>
      </div>
    ) : null;
  const cta = (size: number) =>
    c.cta ? (
      <Serif size={size} color={t.onSurface} italic style={{ marginTop: size * 0.8 }}>
        {`Turn to ${c.cta} →`}
      </Serif>
    ) : null;

  if (fr.shape === "wide") {
    const leftW = 640;
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <Masthead x={40} y={32} w={leftW} t={t} date="" kicker={c.kicker} />
        <At x={40} y={250} w={leftW}>
          <Turned text={c.headline} size={fitSize(c.headline, { width: leftW, lines: 3, max: 76, min: 34, charW: CHAR.serif })} color={t.ink} />
        </At>
        <At x={720} y={0} w={480} h={fr.H} style={{ background: p.surface, padding: 40, justifyContent: "center" }}>
          <Caps size={14} color={t.onSurface} style={{ marginBottom: 22 }}>
            {c.kicker}
          </Caps>
          {body(20, 400)}
          {cta(28)}
        </At>
      </Page>
    );
  }
  const geo = {
    portrait: { M: 56, top: 44, head: 330, band: 940, body: 26, cta: 40, max: 170 },
    square: { M: 48, top: 36, head: 280, band: 740, body: 23, cta: 34, max: 140 },
    tall: { M: 56, top: 236, head: 530, band: 1240, body: 28, cta: 44, max: 180 },
  }[fr.shape];
  const w = fr.W - geo.M * 2;
  const size = fitSize(c.headline, { width: w, lines: 4, max: geo.max, min: 48, height: geo.band - geo.head - 50, lineHeight: 0.98, charW: CHAR.serif });
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <Masthead x={geo.M} y={geo.top} w={w} t={t} date="" kicker={c.kicker} />
      <At x={geo.M} y={geo.head} w={w}>
        <Caps size={17} color={accentOn(t)} style={{ marginBottom: 22 }}>
          {folio ?? c.kicker}
        </Caps>
        <Turned text={c.headline} size={size} color={t.ink} />
      </At>
      <At x={0} y={geo.band} w={fr.W} h={fr.H - geo.band} style={{ background: p.surface, padding: `${geo.M}px ${geo.M}px 0` }}>
        {body(geo.body, w)}
        {cta(geo.cta)}
      </At>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Jury quote: the pull quote
// ─────────────────────────────────────────────────────────────────────────────

function Pull({ fr, t, c, pillars, folio }: { fr: Frame; t: Theme; c: QuoteContent; pillars?: [string, number][] | null; folio?: string }) {
  const p = t.palette;
  const wide = fr.shape === "wide";
  const M = wide ? 40 : fr.shape === "square" ? 48 : 56;
  const geo = wide
    ? { top: 40, quote: 150, band: 470, max: 58 }
    : { portrait: { top: 44, quote: 420, band: 980, max: 100 }, square: { top: 36, quote: 360, band: 790, max: 84 }, tall: { top: 236, quote: 640, band: 1250, max: 108 } }[fr.shape as "portrait" | "square" | "tall"];
  const w = fr.W - M * 2 - (wide && c.score !== null ? 170 : 0);
  const size = fitSize(c.quote, { width: w - 40, lines: 7, max: geo.max, min: 26, height: geo.band - geo.quote - 50, lineHeight: 1.04, charW: CHAR.serifItalic });
  const scoreS = wide ? 130 : 190;
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      {wide ? (
        <At x={M} y={geo.top} w={fr.W - M * 2} style={{ ...row, justifyContent: "space-between" }}>
          <Serif size={44} color={t.ink}>
            Shemoqmedi
          </Serif>
          <Caps size={14} color={t.ink}>
            From the jury
          </Caps>
        </At>
      ) : (
        <Masthead x={M} y={geo.top} w={fr.W - M * 2} t={t} date="" kicker={folio ?? "From the jury"} />
      )}
      <At x={M - 8} y={geo.quote - size * 0.95}>
        <Serif size={size * 2.6} color={accentOn(t)} lead={1}>
          “
        </Serif>
      </At>
      <At x={M + 40} y={geo.quote} w={w - 40}>
        <Serif size={size} color={t.ink} italic lead={1.04}>
          {c.quote}
        </Serif>
      </At>
      <At x={0} y={geo.band} w={fr.W} h={fr.H - geo.band} style={{ background: p.surface }} />
      <At x={M} y={geo.band + (wide ? 22 : 36)} w={fr.W - M * 2 - scoreS - 30}>
        <Caps size={wide ? 13 : 16} color={t.onSurface}>
          {`— ${c.juror}${c.role ? `, ${c.role}` : ""}`}
        </Caps>
        {c.site ? (
          <Serif size={wide ? 30 : 46} color={t.onSurface} style={{ marginTop: 12 }}>
            {c.site}
          </Serif>
        ) : null}
      </At>
      {pillars && !wide ? (
        <At x={M} y={fr.H - (fr.shape === "tall" ? 240 : M) - 170} w={fr.W - M * 2} style={{ ...row, justifyContent: "space-between" }}>
          {[...(c.score !== null ? ([["Jury score", c.score]] as [string, number][]) : []), ...pillars].map(([label, value]) => (
            <div key={label} style={{ ...col, width: 170, height: 170, background: SCORE_BLUE, padding: 16, justifyContent: "space-between" }}>
              <Caps size={12} color="#FFFFFF">
                {label}
              </Caps>
              <Serif size={78} color="#FFFFFF" lead={0.9}>
                {value.toFixed(1)}
              </Serif>
            </div>
          ))}
        </At>
      ) : c.score !== null ? (
        <At x={fr.W - M - scoreS} y={wide ? geo.band - scoreS / 2 : geo.band - scoreS / 2} w={scoreS} h={scoreS} style={{ background: SCORE_BLUE, padding: scoreS * 0.1, justifyContent: "space-between" }}>
          <Caps size={scoreS * 0.07} color="#FFFFFF">
            Jury score
          </Caps>
          <Serif size={scoreS * 0.48} color="#FFFFFF" lead={0.9}>
            {c.score.toFixed(1)}
          </Serif>
        </At>
      ) : null}
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot: a plate with its caption
// ─────────────────────────────────────────────────────────────────────────────

function Plate({ fr, t, c, shot, caption, folio }: { fr: Frame; t: Theme; c: ShotContent; shot: string | null; caption?: string; folio?: string }) {
  const p = t.palette;
  const fig = (c.index.split("/")[0] || "1").trim();
  if (fr.shape === "wide") {
    return (
      <Page W={fr.W} H={fr.H} background={p.base}>
        <At x={0} y={0} w={800} h={fr.H} style={{ background: p.surface }} />
        <At x={40} y={40} w={720} h={fr.H - 80}>
          <Shot src={shot} w={720} h={fr.H - 80} fallback={fade(t.onSurface, 0.1)} />
        </At>
        <At x={840} y={40} w={320} h={fr.H - 80} style={{ justifyContent: "space-between" }}>
          <Caps size={13} color={t.ink}>
            {`Shemoqmedi · ${c.index || "Plate"}`}
          </Caps>
          <div style={{ ...col }}>
            <Caps size={13} color={accentOn(t)}>{`Fig. ${fig}`}</Caps>
            <Serif size={fitSize(c.title, { width: 320, lines: 3, max: 54, min: 26, charW: CHAR.serif })} color={t.ink} style={{ marginTop: 10 }}>
              {c.title}
            </Serif>
            {c.studio ? (
              <Serif size={24} color={t.ink} italic style={{ marginTop: 8 }}>
                {`by ${c.studio}`}
              </Serif>
            ) : null}
          </div>
        </At>
      </Page>
    );
  }
  const geo = { portrait: { M: 56, top: 44, img: [120, 900] as const }, square: { M: 48, top: 36, img: [100, 700] as const }, tall: { M: 56, top: 236, img: [320, 1240] as const } }[fr.shape];
  const w = fr.W - geo.M * 2;
  const [i0, i1] = geo.img;
  return (
    <Page W={fr.W} H={fr.H} background={p.base}>
      <At x={geo.M} y={geo.top} w={w} style={{ ...row, justifyContent: "space-between", paddingBottom: 14, borderBottom: `1px solid ${t.ink}` }}>
        <Serif size={30} color={t.ink}>
          Shemoqmedi
        </Serif>
        <Caps size={15} color={t.ink} style={{ marginTop: 8 }}>
          {folio ?? (c.index ? `Plate ${c.index}` : "Plate")}
        </Caps>
      </At>
      <At x={0} y={i0} w={fr.W} h={i1 - i0} style={{ background: p.surface }} />
      <At x={geo.M} y={i0 + 36} w={w} h={i1 - i0 - 72}>
        <Shot src={shot} w={w} h={i1 - i0 - 72} fallback={fade(t.onSurface, 0.1)} />
      </At>
      <At x={geo.M} y={i1 + 30} w={w} style={{ ...row }}>
        <div style={{ ...col, width: 200 }}>
          <Caps size={15} color={accentOn(t)}>{`Fig. ${fig}`}</Caps>
        </div>
        <div style={{ ...col, width: w - 200 }}>
          <Serif size={fitSize(c.title, { width: w - 200, lines: 2, max: fr.shape === "square" ? 64 : 80, min: 32, charW: CHAR.serif })} color={t.ink}>
            {c.title}
          </Serif>
          {caption ? (
            <Clamp size={22} lines={3} color={t.ink} lineHeight={1.38} style={{ marginTop: 14 }}>
              {caption}
            </Clamp>
          ) : c.studio ? (
            <Serif size={30} color={t.ink} italic style={{ marginTop: 8 }}>
              {`by ${c.studio}`}
            </Serif>
          ) : null}
        </div>
      </At>
    </Page>
  );
}

function single({ template, format, fields, theme, shot, badge }: SingleInput) {
  const fr = frameOf(format);
  const c = contentOf(template, fields);
  switch (c.kind) {
    case "site":
      return <Cover fr={fr} t={theme} c={c} shot={shot} badge={badge} />;
    case "call":
      return <Letter fr={fr} t={theme} c={c} />;
    case "quote":
      return <Pull fr={fr} t={theme} c={c} />;
    case "shot":
      return <Plate fr={fr} t={theme} c={c} shot={shot} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Carousel: the feature, page by page
// ─────────────────────────────────────────────────────────────────────────────

const SLIDE = frameOf("ig_portrait");
const DETAIL = { w: 968, h: 700 };
const PHONE = { w: 400, h: 860 };

function slide({ plan, index, facts: f, theme: t, assets: a }: SlideInput) {
  const kind = plan[index];
  const folio = `${SECTION[kind] || "Cover"} · ${pad2(index + 1)}/${pad2(plan.length)}`;
  const p = t.palette;
  const M = 56;
  const w = SLIDE.W - M * 2;
  switch (kind) {
    case "hook": {
      const c = siteOfStory(f);
      const size = fitSize(f.title, { width: w, lines: 4, max: 190, min: 70, height: 560, lineHeight: 0.92, charW: CHAR.serif });
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <Masthead x={M} y={44} w={w} t={t} date={f.date} />
          <At x={M} y={330} w={w}>
            <Caps size={18} color={accentOn(t)}>{`Cover story · ${c.kicker}`}</Caps>
            <Serif size={size} color={t.ink} lead={0.92} style={{ marginTop: 18 }}>
              {f.title}
            </Serif>
            <Serif size={52} color={t.ink} italic style={{ marginTop: 18 }}>
              {`by ${f.studio}`}
            </Serif>
          </At>
          <At x={0} y={1040} w={SLIDE.W} h={310} style={{ background: p.surface }} />
          <At x={M} y={1080} w={w - 300}>
            <Clamp size={24} lines={4} color={t.onSurface} lineHeight={1.38}>
              {f.tagline || `${f.title}, reviewed by hand.`}
            </Clamp>
          </At>
          <Sticker x={SLIDE.W - M - 250} y={960} d={250} t={t} badge={a.badge} line1={c.award ? TIERS[c.tier].split(" ").slice(-1)[0] : "New"} line2={c.award ? "Award" : "This week"} />
        </Page>
      );
    }
    case "site":
      return <Plate fr={SLIDE} t={t} c={{ kind: "shot", title: hostOf(f.url) || f.title, studio: f.studio, url: f.url, index: "1" }} shot={a.hero} caption={f.tagline} folio={folio} />;
    case "detail": {
      const d = detailIndex(plan, index);
      const note = f.notes[d] ?? "";
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <At x={M} y={44} w={w} style={{ ...row, justifyContent: "space-between", paddingBottom: 14, borderBottom: `1px solid ${t.ink}` }}>
            <Serif size={30} color={t.ink}>
              Shemoqmedi
            </Serif>
            <Caps size={15} color={t.ink} style={{ marginTop: 8 }}>
              {folio}
            </Caps>
          </At>
          <At x={M} y={130} w={DETAIL.w} h={DETAIL.h}>
            <Shot src={a.details[d] ?? null} w={DETAIL.w} h={DETAIL.h} fallback={p.surface} />
          </At>
          <At x={0} y={870} w={SLIDE.W} h={SLIDE.H - 870} style={{ background: p.surface }} />
          <At x={M} y={900} w={w}>
            <Caps size={16} color={t.onSurface}>{`Detail ${d === 0 ? "I" : "II"} · ${chipOf(f, d)}`}</Caps>
            <Serif size={note.length > 40 ? 64 : 84} color={t.onSurface} italic lead={1} style={{ marginTop: 24 }}>
              {note || chipOf(f, d)}
            </Serif>
          </At>
        </Page>
      );
    }
    case "mobile":
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <At x={0} y={0} w={540} h={SLIDE.H} style={{ background: p.surface }} />
          <At x={70} y={245} w={PHONE.w} h={PHONE.h} style={{ borderRadius: 48, overflow: "hidden", border: `6px solid ${t.ink}` }}>
            <Shot src={a.mobile} w={PHONE.w - 12} h={PHONE.h - 12} fallback={p.base} radius={42} />
          </At>
          <At x={590} y={420} w={430}>
            <Caps size={16} color={accentOn(t)}>
              {folio}
            </Caps>
            <Serif size={96} color={t.ink} lead={0.95} style={{ marginTop: 20 }}>
              Made for
            </Serif>
            <Serif size={96} color={t.ink} italic lead={0.95}>
              the thumb.
            </Serif>
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
        <Pull
          fr={SLIDE}
          t={t}
          c={{ kind: "quote", quote: f.quote.replace(/^["“]|["”]$/g, "") || `${f.title}, scored by the jury.`, juror: f.juror || "The jury", role: f.role, site: f.title, score: f.score }}
          pillars={pillars}
          folio={folio}
        />
      );
    }
    case "credits": {
      const rows = [
        ["Studio", f.studio],
        ["Built with", f.tech.slice(0, 7).join(", ")],
        ["Category", f.categories.join(", ")],
        ["Website", hostOf(f.url)],
        ["Read more", f.link],
      ].filter(([, v]) => v);
      return (
        <Page W={SLIDE.W} H={SLIDE.H} background={p.base}>
          <Masthead x={M} y={44} w={w} t={t} date={f.date} kicker={folio} />
          <At x={M} y={330} w={w}>
            <Serif size={120} color={t.ink} italic>
              Colophon
            </Serif>
            <div style={{ ...col, marginTop: 36 }}>
              {rows.map(([label, value]) => (
                <div key={label} style={{ ...row, paddingTop: 20, paddingBottom: 20, borderTop: `1px solid ${t.ink}` }}>
                  <div style={{ ...row, width: 260 }}>
                    <Caps size={16} color={t.ink} style={{ marginTop: 12 }}>
                      {label}
                    </Caps>
                  </div>
                  <Serif size={label === "Read more" ? 30 : 44} color={t.ink} lead={1.05} style={{ width: w - 260 }}>
                    {value}
                  </Serif>
                </div>
              ))}
            </div>
          </At>
        </Page>
      );
    }
    case "cta":
      return <Letter fr={SLIDE} t={t} c={{ kind: "call", kicker: f.kicker, headline: f.ctaHeadline, body: `The full review, every screenshot and the jury's scores: ${f.link}. Made something you're proud of? Submit it.`, cta: "shemoqmedi.space" }} folio={folio} />;
  }
}

function shotWidth(format: FormatId) {
  return format === "link" ? 700 : 1100;
}

export const magazine: FlatStyle = {
  single,
  slide,
  shotWidth,
  slidePictures: { hero: 1100, detail: () => ({ w: DETAIL.w, h: DETAIL.h, zoom: 1.8 }), mobile: PHONE.w * 1.5 },
  grain: true,
};
