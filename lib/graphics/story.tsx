/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { ReactNode } from "react";
import {
  Arrow,
  BrowserGlass,
  Display,
  Glass,
  Label,
  PhoneGlass,
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

// The storytelling Instagram carousel in the glass style: 1080×1350 slides
// cut from one wide panorama, so the backdrop, the site's browser window and
// a thin thread run across the swipe. Each slide is rendered on its own as a
// window onto the panorama; only a slide whose content reaches across the
// seam (BLEEDS) is laid out again for its right-hand neighbour.
//
//   hook     title, award, date, studio
//   site     the site, sharp, in a glass browser (bleeds into the next slide)
//   detail   zoomed crops of the screenshots, each with a one-line chip
//   mobile   the phone view, when a tall screenshot exists
//   jury     quote, juror, the score in blue squares
//   credits  studio, technologies, categories, address
//   cta      where to see it

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;
const M = 88;
const THREAD_Y = 1252;

export type SlideKind = "hook" | "site" | "detail" | "mobile" | "jury" | "credits" | "cta";

export type StoryFacts = {
  title: string;
  studio: string;
  url: string;
  tagline: string;
  /** "Site of the Day", "New on Shemoqmedi"… */
  kicker: string;
  /** "12 Nov 2026" or empty. */
  date: string;
  tier: string;
  score: number | null;
  pillars: { design: number; usability: number; creativity: number; content: number } | null;
  quote: string;
  juror: string;
  role: string;
  tech: string[];
  categories: string[];
  /** shemoqmedi.space/sites/<slug> */
  link: string;
  /** One-line labels for the detail slides ("The type", "The grid"…). */
  chips: string[];
  /** Optional sentence under each detail. */
  notes: string[];
  ctaHeadline: string;
};

/** Which slides a story has, in order (6–8). */
export function storyPlan(f: StoryFacts, has: { details: number; mobile: boolean }): SlideKind[] {
  const plan: SlideKind[] = ["hook", "site"];
  for (let i = 0; i < Math.min(2, Math.max(1, has.details)); i++) plan.push("detail");
  if (has.mobile) plan.push("mobile");
  if (f.quote || f.score !== null) plan.push("jury");
  plan.push("credits", "cta");
  return plan;
}

/** Everything a slide needs that is a picture, prepared by the route (imaging.ts). */
export type StoryAssets = {
  back: string | null;
  frost: string | null;
  hero: string | null;
  details: (string | null)[];
  mobile: string | null;
  badge: string | null;
};

// Fixed geometry, shared by the route (which prepares crops at these sizes) and the slides.
export const SITE_BROWSER = { dx: M, y: 214, w: 1150, h: 700 };
export const DETAIL_TILES: Rect[] = [
  { x: 270, y: 300, w: 722, h: 820 },
  { x: M, y: 214, w: 780, h: 780 },
];
export const DETAIL_ZOOM = [2.1, 1.7];
export const PHONE = { x: 150, y: 214, w: 430, h: 900 };

/** Slides whose content reaches into the next one (the site's browser window is wider than a slide). */
const BLEEDS = new Set<SlideKind>(["site"]);

function Counter({ s, k, n }: { s: Scene; k: number; n: number }) {
  return (
    <div style={{ ...row, fontSize: 19, fontWeight: 600, letterSpacing: 4, color: soft(s, 0.55) }}>
      <span style={{ color: ink(s) }}>{String(k + 1).padStart(2, "0")}</span>
      <span style={{ marginLeft: 8, marginRight: 8 }}>/</span>
      <span>{String(n).padStart(2, "0")}</span>
    </div>
  );
}

function Area({ x, top, bottom, w, children }: { x: number; top: number; bottom: number; w: number; children: ReactNode }) {
  return <div style={{ ...col, position: "absolute", left: x, top, width: w, height: bottom - top, justifyContent: "flex-end" }}>{children}</div>;
}

function At({ x, y, w, children }: { x: number; y: number; w?: number; children: ReactNode }) {
  // No undefined values: satori chokes on them.
  return <div style={{ ...col, position: "absolute", left: x, top: y, ...(w ? { width: w } : {}) }}>{children}</div>;
}

const SECTION: Record<SlideKind, string> = {
  hook: "",
  site: "The site",
  detail: "Up close",
  mobile: "On the phone",
  jury: "The jury",
  credits: "Credits",
  cta: "See it",
};

function slide(kind: SlideKind, k: number, n: number, x0: number, s: Scene, f: StoryFacts, a: StoryAssets, detailIndex: number) {
  const header =
    kind === "hook" ? (
      <At x={x0 + M} y={88}>
        <Wordmark s={s} size={19} />
      </At>
    ) : (
      <At x={x0 + M} y={88}>
        <Label s={s}>{SECTION[kind]}</Label>
      </At>
    );
  const counter = (
    <At x={x0 + SLIDE_W - M - 120} y={88} w={120}>
      <div style={{ ...row, justifyContent: "flex-end" }}>
        <Counter s={s} k={k} n={n} />
      </div>
    </At>
  );

  let body: ReactNode = null;
  switch (kind) {
    case "hook": {
      const width = SLIDE_W - M * 2;
      const [day, ...rest] = f.date.split(" ");
      // Short titles get bigger; the block sits just above the seal either way.
      const size = fit(f.title, width, 4, f.title.length <= 12 ? 230 : 176, 64, 800 - 230 - 21 - 40 - 34 - 48);
      body = (
        <>
          <Area x={x0 + M} top={230} bottom={800} w={width}>
            <Label s={s} dot size={21}>
              {f.kicker}
            </Label>
            <div style={{ display: "flex", marginTop: 40 }}>
              <Display s={s} size={size}>
                {f.title}
              </Display>
            </div>
            <div style={{ display: "flex", marginTop: 34, fontSize: 40, fontWeight: 500, letterSpacing: -0.8, color: soft(s, 0.72) }}>
              by {f.studio}
            </div>
          </Area>
          <Seal s={s} rect={{ x: x0 + M, y: 862, w: 300, h: 300 }} badge={a.badge} tier={f.tier} />
          {f.date ? (
            <At x={x0 + M + 352} y={872} w={560}>
              <div style={{ ...row, alignItems: "flex-end" }}>
                <div style={{ display: "flex", fontSize: 236, fontWeight: 700, lineHeight: 0.8, letterSpacing: -12, color: ink(s) }}>{day}</div>
                <div style={{ ...col, marginLeft: 26, marginBottom: 6 }}>
                  {rest.map((part) => (
                    <div key={part} style={{ display: "flex", fontSize: 30, fontWeight: 600, letterSpacing: 6, textTransform: "uppercase", color: soft(s, 0.75) }}>
                      {part}
                    </div>
                  ))}
                </div>
              </div>
            </At>
          ) : null}
        </>
      );
      break;
    }
    case "site": {
      const b = SITE_BROWSER;
      body = (
        <>
          <BrowserGlass s={s} rect={{ x: x0 + b.dx, y: b.y, w: b.w, h: b.h }} src={a.hero} url={f.url} />
          <At x={x0 + M} y={980} w={SLIDE_W - M * 2}>
            <Display s={s} size={66} weight={700}>
              {host(f.url)}
            </Display>
            {f.tagline ? (
              <div style={{ display: "block", marginTop: 22, fontSize: 30, lineHeight: 1.36, color: soft(s, 0.75), lineClamp: 3, maxWidth: 820 }}>
                {f.tagline}
              </div>
            ) : null}
          </At>
        </>
      );
      break;
    }
    case "detail": {
      const t = DETAIL_TILES[detailIndex % DETAIL_TILES.length];
      const tile = { ...t, x: x0 + t.x };
      const chip = f.chips[detailIndex] ?? (detailIndex === 0 ? "The details" : "The craft");
      const note = f.notes[detailIndex] ?? "";
      const chipW = pillWidth(chip, 26);
      const chipRect =
        detailIndex % 2 === 0
          ? { x: tile.x - 60, y: tile.y - 44, w: chipW, h: 84 }
          : { x: tile.x + tile.w - chipW + 70, y: tile.y + tile.h - 46, w: chipW, h: 84 };
      body = (
        <>
          <Glass s={s} rect={tile} radius={40} pad={12}>
            <div style={{ display: "flex", width: tile.w - 26, height: tile.h - 26, borderRadius: 30, overflow: "hidden" }}>
              {a.details[detailIndex] ? (
                <img src={a.details[detailIndex]!} width={tile.w - 26} height={tile.h - 26} style={{ width: tile.w - 26, height: tile.h - 26 }} />
              ) : null}
            </div>
          </Glass>
          <Glass s={s} rect={chipRect} radius={42} inner={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 12, height: 12, borderRadius: 12, background: s.palette.accent, marginRight: 16 }} />
            <div style={{ display: "flex", fontSize: 26, fontWeight: 600, letterSpacing: -0.3, color: ink(s) }}>{chip}</div>
          </Glass>
          {note ? (
            <At x={x0 + M} y={detailIndex % 2 === 0 ? 1150 : 1064} w={detailIndex % 2 === 0 ? 880 : 900}>
              <div style={{ display: "block", fontSize: 42, fontWeight: 600, lineHeight: 1.14, letterSpacing: -1, color: ink(s), lineClamp: 2 }}>
                {note}
              </div>
            </At>
          ) : null}
        </>
      );
      break;
    }
    case "mobile": {
      body = (
        <>
          <PhoneGlass s={s} rect={{ x: x0 + PHONE.x, y: PHONE.y, w: PHONE.w, h: PHONE.h }} src={a.mobile} />
          <At x={x0 + 640} y={640} w={360}>
            <Display s={s} size={74}>
              Made for the thumb.
            </Display>
          </At>
        </>
      );
      break;
    }
    case "jury": {
      const hasScore = f.score !== null;
      const cardH = hasScore ? 500 : 820;
      const quote = f.quote.replace(/^["“]|["”]$/g, "");
      body = (
        <>
          {quote ? (
            <Glass s={s} rect={{ x: x0 + M, y: 200, w: SLIDE_W - M * 2, h: cardH }} pad="54px 56px" inner={{ justifyContent: "space-between" }}>
              <div style={{ ...col }}>
                <QuoteMark size={58} color={s.palette.accent} />
                <div style={{ display: "flex", marginTop: 30, fontSize: fit(quote, 790, hasScore ? 4 : 7, hasScore ? 50 : 64, 28), fontWeight: 500, lineHeight: 1.16, letterSpacing: -1, color: ink(s) }}>
                  {quote}
                </div>
              </div>
              <div style={{ ...row, alignItems: "center" }}>
                <div style={{ width: 44, height: 2, background: soft(s, 0.4), marginRight: 22 }} />
                <div style={{ ...col }}>
                  <span style={{ fontSize: 26, fontWeight: 600, color: ink(s) }}>{f.juror}</span>
                  {f.role ? <span style={{ fontSize: 21, color: soft(s, 0.65), marginTop: 4 }}>{f.role}</span> : null}
                </div>
              </div>
            </Glass>
          ) : null}
          {hasScore ? (
            <>
              <At x={x0 + M} y={quote ? 776 : 300} w={470}>
                <Label s={s}>Jury score</Label>
                <div style={{ ...row, alignItems: "flex-end", marginTop: 18 }}>
                  <div style={{ display: "flex", fontSize: 232, fontWeight: 700, lineHeight: 0.84, letterSpacing: -12, color: ink(s) }}>
                    {f.score!.toFixed(1)}
                  </div>
                  <div style={{ display: "flex", marginLeft: 14, marginBottom: 8, fontSize: 34, fontWeight: 500, color: soft(s, 0.6) }}>/10</div>
                </div>
              </At>
              {f.pillars
                ? (
                    [
                      ["Design", f.pillars.design],
                      ["Usability", f.pillars.usability],
                      ["Creativity", f.pillars.creativity],
                      ["Content", f.pillars.content],
                    ] as const
                  ).map(([label, value], i) => (
                    <ScoreTile
                      key={label}
                      s={s}
                      rect={{ x: x0 + 600 + (i % 2) * 206, y: (quote ? 770 : 300) + Math.floor(i / 2) * 206, w: 190, h: 190 }}
                      value={value.toFixed(1)}
                      label={label}
                    />
                  ))
                : null}
            </>
          ) : null}
        </>
      );
      break;
    }
    case "credits": {
      const width = SLIDE_W - M * 2;
      const techRows = Math.ceil(f.tech.slice(0, 7).join("").length / 34) || 1;
      const creditsH = 92 + (f.tech.length ? 100 + techRows * 76 : 0) + (f.categories.length ? 176 : 0) + 104;
      const chip = (t: string) => (
        <div
          key={t}
          style={{
            ...row,
            alignItems: "center",
            height: 64,
            padding: "0 28px",
            marginRight: 12,
            marginBottom: 12,
            borderRadius: 56,
            border: `1px solid ${s.light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.3)"}`,
            background: s.light ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.1)",
            fontSize: 26,
            fontWeight: 500,
            color: ink(s),
          }}
        >
          {t}
        </div>
      );
      const line = (label: string, content: ReactNode, last = false) => (
        <div style={{ ...col, paddingBottom: last ? 0 : 30, marginBottom: last ? 0 : 30, borderBottom: last ? "none" : `1px solid ${soft(s, 0.16)}` }}>
          <Label s={s} size={17}>
            {label}
          </Label>
          <div style={{ ...row, flexWrap: "wrap", marginTop: 18 }}>{content}</div>
        </div>
      );
      body = (
        <>
          <At x={x0 + M} y={Math.max(236, 1180 - creditsH - 330)} w={width}>
            <Label s={s} size={17}>
              Studio
            </Label>
            <div style={{ display: "flex", marginTop: 22 }}>
              <Display s={s} size={fit(f.studio, width, 2, 120, 60)}>
                {f.studio}
              </Display>
            </div>
          </At>
          <Glass s={s} rect={{ x: x0 + M, y: 1180 - creditsH, w: width, h: creditsH }} pad="46px 50px">
            {f.tech.length ? line("Built with", f.tech.slice(0, 7).map(chip)) : null}
            {f.categories.length ? line("Category", f.categories.slice(0, 3).map(chip)) : null}
            {line(
              "Website",
              <div style={{ display: "flex", fontSize: 40, fontWeight: 600, letterSpacing: -0.8, color: ink(s) }}>{host(f.url)}</div>,
              true,
            )}
          </Glass>
        </>
      );
      break;
    }
    case "cta": {
      const width = SLIDE_W - M * 2;
      const pillText = "See it on shemoqmedi.space";
      const pillW = Math.min(width, pillWidth(pillText, 30) + 60);
      body = (
        <>
          <At x={x0 + M} y={330} w={width}>
            <Label s={s} dot>
              {f.kicker}
            </Label>
            <div style={{ display: "flex", marginTop: 40 }}>
              <Display s={s} size={fit(f.ctaHeadline, width, 3, 150, 64)}>
                {f.ctaHeadline}
              </Display>
            </div>
          </At>
          <Glass s={s} rect={{ x: x0 + M, y: 900, w: pillW, h: 108 }} radius={54} inner={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: "0 40px 0 46px" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 600, letterSpacing: -0.4, color: ink(s) }}>{pillText}</div>
            <Arrow size={34} color={ink(s)} />
          </Glass>
          <At x={x0 + M} y={1046} w={width}>
            <div style={{ display: "flex", fontSize: 22, color: soft(s, 0.6) }}>{f.link}</div>
            <div style={{ display: "flex", marginTop: 10, fontSize: 22, color: soft(s, 0.6) }}>Made something you&apos;re proud of? shemoqmedi.space/submit</div>
          </At>
        </>
      );
      break;
    }
  }
  return (
    <div key={k} style={{ display: "flex" }}>
      {header}
      {counter}
      {body}
    </div>
  );
}

/**
 * Slide `index` of the story: the backdrop window, then the panorama (this
 * slide and its neighbours, which may reach across the seam), then the thread.
 */
export function storySlide({
  plan,
  index,
  scene,
  facts,
  assets,
}: {
  plan: SlideKind[];
  index: number;
  scene: Scene;
  facts: StoryFacts;
  assets: StoryAssets;
}) {
  const n = plan.length;
  const total = n * SLIDE_W;
  const left = index * SLIDE_W;
  const detailIndexOf = (k: number) => plan.slice(0, k).filter((p) => p === "detail").length;
  // Only this slide, plus the one before when its content bleeds across the seam.
  const visible = [index - 1, index].filter((k) => k >= 0 && (k === index || BLEEDS.has(plan[k])));
  return (
    <div style={{ display: "flex", position: "relative", width: SLIDE_W, height: SLIDE_H, overflow: "hidden", fontFamily: "Inter", background: scene.layer === "shared" ? "transparent" : scene.palette.base }}>
      {assets.back ? <img src={assets.back} width={SLIDE_W} height={SLIDE_H} style={{ position: "absolute", left: 0, top: 0 }} /> : null}
      <div style={{ display: "flex", position: "absolute", left: -left, top: 0, width: total, height: SLIDE_H }}>
        {/* The thread: one hairline across the whole carousel, a tick at every seam. */}
        <div style={{ position: "absolute", left: M, top: THREAD_Y, width: total - M * 2, height: 2, background: soft(scene, 0.22) }} />
        {Array.from({ length: n - 1 }, (_, k) => (
          <div key={`t${k}`} style={{ position: "absolute", left: (k + 1) * SLIDE_W - 5, top: THREAD_Y - 4, width: 10, height: 10, borderRadius: 10, background: soft(scene, 0.45) }} />
        ))}
        <div style={{ position: "absolute", left: M, top: THREAD_Y - 6, width: 14, height: 14, borderRadius: 14, background: scene.palette.accent }} />
        {visible.map((k) => slide(plan[k], k, n, k * SLIDE_W, scene, facts, assets, detailIndexOf(k)))}
      </div>
    </div>
  );
}
