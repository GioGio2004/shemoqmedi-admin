"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { StudioConfig } from "@/convex/studioConfig";
import {
  DENSITY_SCALE,
  fontStack,
  formatPrice,
  tr,
  withAlpha,
} from "./presets";
import { ItemCard, FeaturedCard, type PreviewItem } from "./PreviewCards";
import { Camera, Clock, Lock, Mail, MessageCircle, Star } from "lucide-react";

gsap.registerPlugin(useGSAP);

// ─────────────────────────────────────────────────────────────────────────────
// MenuPreview — the live render of a StudioConfig against the venue's real
// menu, framed as a phone or a desktop browser window. This is the same
// composition the consumer renderer will implement from `published` configs.
// ─────────────────────────────────────────────────────────────────────────────

export type PreviewCategory = {
  id: string;
  name: Record<string, string>;
  imageUrl: string | null;
  items: PreviewItem[];
};

export type PreviewOrg = {
  name: string;
  slug: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  tagline: Record<string, string> | string | null;
  operatingHours: Array<{ day: string; hours: string }> | null;
  socialLinks: { whatsapp?: string; instagram?: string; email?: string } | null;
  /** ISO code from organizations.currency ("GEL", "USD"…). */
  currency?: string;
};

export type PreviewViewport = "phone" | "desktop";

const DESKTOP_W = 1024;
const DESKTOP_H = 640;

// Demo menu so a brand-new venue still gets a designable preview.
const DEMO_MENU: PreviewCategory[] = [
  {
    id: "demo-coffee",
    name: { en: "Coffee", ka: "ყავა" },
    imageUrl: null,
    items: [
      { id: "d1", name: { en: "Flat White", ka: "ფლეტ ვაითი" }, description: { en: "Double ristretto, silky micro-foam." }, price: 950, imageUrl: null, tags: ["hot"], allergens: ["milk"], isFeatured: true },
      { id: "d2", name: { en: "Cold Brew Tonic", ka: "ცივი ყავა ტონიკით" }, description: { en: "18-hour steep over Georgian tonic." }, price: 1200, imageUrl: null, tags: ["cold"], isFeatured: false },
      { id: "d3", name: { en: "Cortado", ka: "კორტადო" }, description: { en: "Equal parts espresso and steamed milk." }, price: 850, imageUrl: null, tags: [], allergens: ["milk"], isFeatured: false },
    ],
  },
  {
    id: "demo-kitchen",
    name: { en: "Kitchen", ka: "სამზარეულო" },
    imageUrl: null,
    items: [
      { id: "d4", name: { en: "Khachapuri Toast", ka: "ხაჭაპურის ტოსტი" }, description: { en: "Imeruli cheese, sourdough, chili honey." }, price: 1600, imageUrl: null, tags: ["veg"], allergens: ["gluten", "milk", "eggs"], isFeatured: true },
      { id: "d5", name: { en: "Beet Carpaccio", ka: "ჭარხლის კარპაჩო" }, description: { en: "Walnut cream, tarragon oil." }, price: 1400, imageUrl: null, tags: ["vegan"], allergens: ["nuts"], isFeatured: false },
      { id: "d6", name: { en: "Matsoni Bowl", ka: "მაწვნის ბოული" }, description: { en: "House granola, seasonal fruit, honey." }, price: 1100, imageUrl: null, tags: [], allergens: ["milk", "gluten", "nuts"], isFeatured: false },
    ],
  },
];

export function MenuPreview({
  config,
  org,
  menu,
  locale,
  replayKey,
  viewport = "phone",
}: {
  config: StudioConfig;
  org: PreviewOrg;
  menu: PreviewCategory[];
  locale: string;
  replayKey: number;
  viewport?: PreviewViewport;
}) {
  const { theme, hero, cards, nav, motion, sections } = config;
  const isDesktop = viewport === "desktop";
  // Mirror the live renderer: categories without items never render.
  const realMenu = useMemo(() => menu.filter((c) => c.items.length > 0), [menu]);
  const isDemo = realMenu.length === 0;
  const data = isDemo ? DEMO_MENU : realMenu;

  const [activeCat, setActiveCat] = useState(0);
  const category = data[Math.min(activeCat, data.length - 1)];

  const featured = useMemo(() => {
    const starred = data.flatMap((c) => c.items).filter((i) => i.isFeatured);
    return starred.slice(0, 8);
  }, [data]);

  const scopeRef = useRef<HTMLDivElement>(null);

  // ── Desktop frame scales down to fit its container ────────────────────────
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!isDesktop) return;
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, el.clientWidth / (DESKTOP_W + 2)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDesktop]);

  // ── GSAP entrance — RULED recipe: expo.out, 0.6s workhorse ÷ speed ────────
  useGSAP(
    () => {
      if (!motion.enabled || motion.entrance === "none") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const els = gsap.utils.toArray<HTMLElement>("[data-anim]");
      if (!els.length) return;

      const d = 0.6 / motion.speed;
      const stagger = 0.055 / motion.speed;

      switch (motion.entrance) {
        case "fade-up":
          gsap.fromTo(
            els,
            { autoAlpha: 0, y: 22 },
            { autoAlpha: 1, y: 0, duration: d, ease: "expo.out", stagger, overwrite: "auto" },
          );
          break;
        case "stagger-rise":
          gsap.fromTo(
            els,
            { autoAlpha: 0, y: 46, scale: 0.985 },
            { autoAlpha: 1, y: 0, scale: 1, duration: d * 1.15, ease: "expo.out", stagger: stagger * 1.4, overwrite: "auto" },
          );
          break;
        case "slide-mask":
          gsap.fromTo(
            els,
            { clipPath: "inset(0 100% 0 0)", autoAlpha: 1 },
            { clipPath: "inset(0 0% 0 0)", duration: d, ease: "expo.out", stagger, overwrite: "auto" },
          );
          break;
        case "scale-in":
          gsap.fromTo(
            els,
            { autoAlpha: 0, scale: 0.9 },
            { autoAlpha: 1, scale: 1, duration: d * 0.9, ease: "expo.out", stagger: stagger * 0.8, overwrite: "auto" },
          );
          break;
      }
    },
    {
      scope: scopeRef,
      dependencies: [
        replayKey,
        viewport,
        motion.enabled,
        motion.entrance,
        motion.speed,
        cards.variant,
        cards.columns,
        hero.preset,
        activeCat,
        sections.map((s) => `${s.id}:${s.visible}`).join(","),
      ],
    },
  );

  // ── Theme → CSS vars ──────────────────────────────────────────────────────
  const vars = {
    "--sd-bg": theme.background,
    "--sd-surface": theme.surface,
    "--sd-surface-70": withAlpha(theme.surface, 0.72),
    "--sd-ink": theme.ink,
    "--sd-ink-60": withAlpha(theme.ink, 0.62),
    "--sd-ink-25": withAlpha(theme.ink, 0.25),
    "--sd-ink-14": withAlpha(theme.ink, 0.14),
    "--sd-ink-08": withAlpha(theme.ink, 0.08),
    "--sd-ink-06": withAlpha(theme.ink, 0.06),
    "--sd-accent": theme.accent,
    "--sd-accent-ink": theme.accentInk,
    "--sd-accent-35": withAlpha(theme.accent, 0.35),
    "--sd-accent-08": withAlpha(theme.accent, 0.12),
    "--sd-radius": `${theme.radius}px`,
    "--sd-density": String(DENSITY_SCALE[theme.density]),
    "--sd-font-heading": fontStack(theme.headingFont),
    "--sd-font-body": fontStack(theme.bodyFont),
  } as React.CSSProperties;

  const hoverCss =
    motion.enabled && motion.hover !== "none"
      ? {
          lift: `.sdp-screen .sd-card:hover { transform: translateY(-4px); box-shadow: 0 14px 30px rgba(0,0,0,0.28); }`,
          tilt: `.sdp-screen .sd-card:hover { transform: rotate(1.4deg) scale(1.02); }`,
          glow: `.sdp-screen .sd-card:hover { box-shadow: 0 0 0 1px var(--sd-accent), 0 10px 30px var(--sd-accent-35); }`,
        }[motion.hover]
      : "";

  const pad = isDesktop
    ? "calc(28px * var(--sd-density))"
    : "calc(16px * var(--sd-density))";

  const listVariant = cards.variant === "minimal" || cards.variant === "editorial";
  // Mirror the live renderer's honest columns: 1 = single column at every
  // width; 2 = two on phones, three at desktop widths.
  const columnCount = listVariant ? 1 : Math.max(1, Math.min(cards.columns || 2, 2));
  const gridColumns = listVariant
    ? "1fr"
    : `repeat(${columnCount === 1 ? 1 : isDesktop ? 3 : 2}, minmax(0, 1fr))`;

  // ── Section renderers ─────────────────────────────────────────────────────
  const renderHero = () => {
    const alignCls = hero.alignment === "center" ? "items-center text-center" : "items-start text-left";
    const tagline = tr(org.tagline, locale);

    if (hero.preset === "poster") {
      // Proportional to the live page's min(72vh, 560px) inside each frame.
      const posterH = isDesktop ? 460 : 518;
      return (
        <div className="relative" style={{ minHeight: posterH }}>
          {org.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(160deg, ${withAlpha(theme.accent, 0.5)}, var(--sd-bg) 80%)` }}
            />
          )}
          <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 25%, rgba(0,0,0,0.78) 100%)" }} />
          <div data-anim className={`relative flex flex-col justify-end gap-1.5 ${alignCls}`} style={{ padding: pad, minHeight: posterH }}>
            {hero.showLogo && org.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logoUrl} alt="" className="mb-1 h-9 w-9 rounded-full border border-white/30 object-cover" />
            )}
            <h1 className="font-bold leading-none tracking-tight" style={{ color: "#FFF", fontFamily: "var(--sd-font-heading)", fontSize: isDesktop ? 40 : 26 }}>
              {org.name}
            </h1>
            {hero.showTagline && tagline && (
              <p style={{ color: "rgba(255,255,255,0.78)", fontSize: isDesktop ? 14 : 12 }}>{tagline}</p>
            )}
          </div>
        </div>
      );
    }

    if (hero.preset === "editorial") {
      return (
        <div data-anim className={`flex flex-col gap-2 ${alignCls}`} style={{ padding: `calc(28px * var(--sd-density)) ${pad} calc(18px * var(--sd-density))` }}>
          <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--sd-accent)", fontFamily: "var(--sd-font-body)" }}>
            Menu — {org.slug || "venue"}
          </p>
          <div className="w-full" style={{ height: 1, background: "var(--sd-ink-14)" }} />
          <h1 className="font-semibold leading-[1.02] tracking-tight" style={{ color: "var(--sd-ink)", fontFamily: "var(--sd-font-heading)", fontSize: isDesktop ? 46 : 30 }}>
            {org.name}
          </h1>
          {hero.showTagline && tagline && (
            <p className="max-w-[85%] leading-relaxed" style={{ color: "var(--sd-ink-60)", fontFamily: "var(--sd-font-body)", fontSize: isDesktop ? 14 : 12 }}>
              {tagline}
            </p>
          )}
          <div className="w-full" style={{ height: 1, background: "var(--sd-ink-14)" }} />
        </div>
      );
    }

    // classic
    return (
      <div className="relative">
        {org.coverImageUrl && (
          <div className="relative w-full overflow-hidden" style={{ height: isDesktop ? 180 : 112 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={org.coverImageUrl} alt="" className="h-full w-full object-cover" />
            <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent, ${theme.background})` }} />
          </div>
        )}
        <div data-anim className={`flex flex-col gap-1.5 ${alignCls}`} style={{ padding: `calc(${org.coverImageUrl ? "10px" : "26px"} * var(--sd-density)) ${pad} calc(14px * var(--sd-density))` }}>
          {hero.showLogo && (
            org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logoUrl} alt="" className="h-11 w-11 rounded-full object-cover" style={{ border: "2px solid var(--sd-ink-14)" }} />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full text-[16px] font-bold" style={{ background: "var(--sd-accent)", color: "var(--sd-accent-ink)" }}>
                {org.name.charAt(0).toUpperCase()}
              </div>
            )
          )}
          <h1 className="font-bold leading-tight tracking-tight" style={{ color: "var(--sd-ink)", fontFamily: "var(--sd-font-heading)", fontSize: isDesktop ? 34 : 24 }}>
            {org.name}
          </h1>
          {hero.showTagline && tagline && (
            <p className="leading-relaxed" style={{ color: "var(--sd-ink-60)", fontFamily: "var(--sd-font-body)", fontSize: isDesktop ? 14 : 12 }}>
              {tagline}
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderFeatured = () => {
    if (!featured.length) return null;
    return (
      <div style={{ padding: `calc(8px * var(--sd-density)) 0` }}>
        <div className="flex items-center gap-1.5" style={{ padding: `0 ${pad} calc(8px * var(--sd-density))` }}>
          <Star className="h-3 w-3" style={{ color: "var(--sd-accent)" }} fill="currentColor" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--sd-ink-60)", fontFamily: "var(--sd-font-body)" }}>
            Featured
          </span>
        </div>
        <div className="sdp-strip flex gap-2 overflow-x-auto" style={{ padding: `0 ${pad} 4px` }}>
          {featured.map((item) => (
            <div key={item.id} data-anim>
              <FeaturedCard item={item} locale={locale} wide={isDesktop} currency={org.currency} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderNav = () => {
    // Live renderer hides the nav entirely for a single category.
    if (data.length <= 1) return null;
    const wrap = (
      <div className="sdp-strip flex gap-1.5 overflow-x-auto" style={{ padding: `calc(10px * var(--sd-density)) ${pad}` }}>
        {data.map((cat, i) => {
          const active = i === Math.min(activeCat, data.length - 1);
          const label = tr(cat.name, locale);
          if (nav.style === "underline") {
            return (
              <button key={cat.id} type="button" onClick={() => setActiveCat(i)} className="shrink-0 pb-1 text-[12px] font-medium transition-colors" style={{ color: active ? "var(--sd-ink)" : "var(--sd-ink-60)", borderBottom: active ? "2px solid var(--sd-accent)" : "2px solid transparent", fontFamily: "var(--sd-font-body)" }}>
                {label}
              </button>
            );
          }
          if (nav.style === "chips") {
            return (
              <button key={cat.id} type="button" onClick={() => setActiveCat(i)} className="shrink-0 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors" style={{ color: active ? "var(--sd-accent)" : "var(--sd-ink-60)", border: active ? "1px solid var(--sd-accent)" : "1px solid var(--sd-ink-14)", borderRadius: "calc(var(--sd-radius) * 0.6)", fontFamily: "var(--sd-font-body)" }}>
                <span style={{ opacity: 0.6 }}>{String(i + 1).padStart(2, "0")}</span>
                <span className="ml-1">{label}</span>
              </button>
            );
          }
          // pills
          return (
            <button key={cat.id} type="button" onClick={() => setActiveCat(i)} className="shrink-0 px-3 py-1.5 text-[12px] font-medium transition-colors" style={{ background: active ? "var(--sd-accent)" : "var(--sd-surface)", color: active ? "var(--sd-accent-ink)" : "var(--sd-ink-60)", borderRadius: 999, border: active ? "1px solid transparent" : "1px solid var(--sd-ink-08)", fontFamily: "var(--sd-font-body)" }}>
              {label}
            </button>
          );
        })}
      </div>
    );

    if (!nav.sticky) return wrap;
    return (
      <div className="sticky top-0 z-10 backdrop-blur-md" style={{ background: withAlpha(theme.background, 0.82) }}>
        {wrap}
      </div>
    );
  };

  const renderMenu = () => (
    <div>
      {renderNav()}
      <div style={{ padding: `calc(4px * var(--sd-density)) ${pad} calc(16px * var(--sd-density))` }}>
        {category && (
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold" style={{ color: "var(--sd-ink)", fontFamily: "var(--sd-font-heading)", fontSize: isDesktop ? 20 : 15 }}>
              {tr(category.name, locale)}
            </h2>
            <span className="text-[10px] tabular-nums" style={{ color: "var(--sd-ink-60)" }}>
              {category.items.length} items
            </span>
          </div>
        )}
        <div
          className={listVariant && isDesktop ? "mx-auto w-full max-w-[720px]" : undefined}
          style={{
            display: "grid",
            gridTemplateColumns: gridColumns,
            gap: listVariant ? 0 : "calc(10px * var(--sd-density))",
          }}
        >
          {(category?.items ?? []).map((item) => (
            <div key={item.id} data-anim>
              <ItemCard item={item} locale={locale} cards={cards} currency={org.currency} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderInfo = () => {
    const hours = org.operatingHours ?? [];
    const socials = org.socialLinks ?? {};
    return (
      <div data-anim style={{ padding: `calc(18px * var(--sd-density)) ${pad} calc(26px * var(--sd-density))`, borderTop: "1px solid var(--sd-ink-14)" }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--sd-ink-60)", fontFamily: "var(--sd-font-body)" }}>
          {org.name}
        </p>
        {hours.length > 0 && (
          <div className="mt-2 flex flex-col gap-1" style={{ maxWidth: isDesktop ? 380 : undefined }}>
            {hours.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]" style={{ color: "var(--sd-ink-60)" }}>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" style={{ color: "var(--sd-accent)" }} />
                  {h.day}
                </span>
                <span className="tabular-nums" style={{ color: "var(--sd-ink)" }}>{h.hours}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2.5">
          {socials.instagram && <Camera className="h-3.5 w-3.5" style={{ color: "var(--sd-ink-60)" }} />}
          {socials.whatsapp && <MessageCircle className="h-3.5 w-3.5" style={{ color: "var(--sd-ink-60)" }} />}
          {socials.email && <Mail className="h-3.5 w-3.5" style={{ color: "var(--sd-ink-60)" }} />}
          <span className="ml-auto text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--sd-ink-25)" }}>
            Powered by VOLOO <span style={{ color: "var(--sd-accent)" }}>■</span>
          </span>
        </div>
      </div>
    );
  };

  const SECTION_RENDERERS: Record<string, () => React.ReactNode> = {
    hero: renderHero,
    featured: renderFeatured,
    menu: renderMenu,
    info: renderInfo,
  };

  const screenStyles = (
    <style>{`
      .sdp-screen .sd-card { transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
      ${hoverCss}
    `}</style>
  );

  const sectionsContent = sections
    .filter((s) => s.visible)
    .map((s) => <div key={s.id}>{SECTION_RENDERERS[s.id]?.() ?? null}</div>);

  const demoChip = isDemo ? (
    <span className="v-t-micro rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-v-faint backdrop-blur">
      Demo data — this venue has no menu items yet
    </span>
  ) : null;

  // ── Desktop browser frame ─────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <div ref={stageRef} className="flex w-full max-w-[1060px] flex-col items-center gap-3">
        {demoChip}
        <div className="w-full" style={{ height: (DESKTOP_H + 44) * scale + 2 }}>
          <div
            className="origin-top-left overflow-hidden rounded-2xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
            style={{ width: DESKTOP_W + 2, transform: `scale(${scale})` }}
          >
            {/* Browser chrome */}
            <div className="flex h-11 items-center gap-3 border-b border-white/10 bg-white/[0.07] px-4 backdrop-blur-2xl">
              <span className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
              </span>
              <span className="mx-auto flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/25 px-3 py-1 font-v-mono text-[10px] text-v-mut">
                <Lock className="h-2.5 w-2.5 text-v-faint" />
                shemoqmedi.space/menu/{org.slug || "venue"}
              </span>
              <span className="w-12" aria-hidden />
            </div>
            {screenStyles}
            <div
              ref={scopeRef}
              className="sdp-screen overflow-y-auto"
              style={{ ...vars, height: DESKTOP_H, background: "var(--sd-bg)", fontFamily: "var(--sd-font-body)" }}
            >
              {sectionsContent}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Phone frame ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-3">
      {demoChip}
      <div className="rounded-[44px] border border-white/10 bg-black/60 p-2 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="relative overflow-hidden rounded-[36px]" style={{ width: 375, height: 720 }}>
          {screenStyles}
          <div
            ref={scopeRef}
            className="sdp-screen h-full overflow-y-auto"
            style={{ ...vars, background: "var(--sd-bg)", fontFamily: "var(--sd-font-body)" }}
          >
            {/* status bar spacer */}
            <div className="flex items-center justify-between px-6 pt-3 pb-1">
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: "var(--sd-ink-60)" }}>9:41</span>
              <span className="h-[3px] w-16 rounded-full" style={{ background: "var(--sd-ink-14)" }} />
              <span className="text-[10px]" style={{ color: "var(--sd-ink-60)" }}>▮▮▮</span>
            </div>
            {sectionsContent}
          </div>
        </div>
      </div>
    </div>
  );
}

export { formatPrice };
