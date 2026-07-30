"use client";

import type { StudioConfig } from "@/convex/studioConfig";
import {
  STUDIO_PALETTES,
  STUDIO_FONTS,
  CARD_VARIANTS,
  HERO_PRESETS,
  NAV_STYLES,
  ENTRANCE_PRESETS,
  HOVER_PRESETS,
  SECTION_META,
  bestInkFor,
} from "./presets";
import {
  PanelSection,
  Field,
  Segmented,
  Toggle,
  Slider,
  ColorField,
  OptionTile,
} from "./controls";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

type PatchFn = (patch: Partial<StudioConfig>) => void;

// ─────────────────────────────────────────────────────────────────────────────
// 01 · THEME
// ─────────────────────────────────────────────────────────────────────────────
export function ThemePanel({
  config,
  patch,
}: {
  config: StudioConfig;
  patch: PatchFn;
}) {
  const t = config.theme;
  const setTheme = (p: Partial<StudioConfig["theme"]>) =>
    patch({ theme: { ...t, ...p } });

  return (
    <PanelSection index="01" label="Theme">
      <Field label="Palette">
        <div className="grid grid-cols-3 gap-1.5">
          {STUDIO_PALETTES.map((p) => {
            const active =
              p.theme.background === t.background && p.theme.accent === t.accent;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setTheme(p.theme)}
                className={cn(
                  "v-press flex flex-col gap-1 rounded-xl border p-1.5 transition-colors",
                  active
                    ? "border-v-accent/70 ring-1 ring-v-accent/30"
                    : "border-white/10 hover:border-white/30",
                )}
              >
                <span
                  className="flex h-8 items-center justify-center gap-1 rounded-lg"
                  style={{ backgroundColor: p.theme.background }}
                >
                  <span
                    className="h-3 w-3 rounded-[1px]"
                    style={{ backgroundColor: p.theme.surface }}
                  />
                  <span
                    className="h-3 w-3 rounded-[1px]"
                    style={{ backgroundColor: p.theme.accent }}
                  />
                  <span
                    className="h-3 w-1 rounded-[1px]"
                    style={{ backgroundColor: p.theme.ink }}
                  />
                </span>
                <span
                  className={cn(
                    "text-[10px] leading-none",
                    active ? "text-v-accent" : "text-v-mut",
                  )}
                >
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <ColorField
        label="Background"
        value={t.background}
        onChange={(v) => setTheme({ background: v })}
      />
      <ColorField
        label="Surface"
        value={t.surface}
        onChange={(v) => setTheme({ surface: v })}
      />
      <ColorField
        label="Text"
        value={t.ink}
        onChange={(v) => setTheme({ ink: v })}
      />
      <ColorField
        label="Accent"
        value={t.accent}
        onChange={(v) => setTheme({ accent: v, accentInk: bestInkFor(v) })}
      />

      <Field label="Heading font">
        <Segmented
          size="sm"
          value={t.headingFont}
          options={Object.entries(STUDIO_FONTS).map(([key, f]) => ({
            key,
            label: f.label,
          }))}
          onChange={(v) => setTheme({ headingFont: v })}
        />
      </Field>
      <Field label="Body font">
        <Segmented
          size="sm"
          value={t.bodyFont}
          options={Object.entries(STUDIO_FONTS).map(([key, f]) => ({
            key,
            label: f.label,
          }))}
          onChange={(v) => setTheme({ bodyFont: v })}
        />
      </Field>

      <Field label="Corner radius">
        <Slider
          value={t.radius}
          min={0}
          max={24}
          step={1}
          onChange={(v) => setTheme({ radius: v })}
          format={(v) => `${v}px`}
        />
      </Field>

      <Field label="Density">
        <Segmented
          value={t.density}
          options={[
            { key: "compact" as const, label: "Compact" },
            { key: "cozy" as const, label: "Cozy" },
            { key: "spacious" as const, label: "Spacious" },
          ]}
          onChange={(v) => setTheme({ density: v })}
        />
      </Field>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 02 · CARDS
// ─────────────────────────────────────────────────────────────────────────────
function CardMockup({ variant }: { variant: string }) {
  // Tiny CSS sketches of each card so the picker reads at a glance.
  switch (variant) {
    case "classic":
      return (
        <div className="m-2 flex w-10 flex-col gap-1 rounded-[2px] border border-white/15 p-1">
          <div className="h-5 rounded-[1px] bg-white/25" />
          <div className="h-1 w-3/4 rounded-full bg-white/40" />
          <div className="h-1 w-1/2 rounded-full bg-white/20" />
        </div>
      );
    case "minimal":
      return (
        <div className="m-2 flex w-12 flex-col justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="h-1 w-5 rounded-full bg-white/40" />
              <div className="h-px flex-1 border-b border-dotted border-white/30" />
              <div className="h-1 w-2 rounded-full bg-white/40" />
            </div>
          ))}
        </div>
      );
    case "glass":
      return (
        <div className="relative m-2 w-10 overflow-hidden rounded-[2px] bg-white/25">
          <div className="absolute inset-x-1 bottom-1 rounded-[1px] bg-white/50 p-0.5 backdrop-blur">
            <div className="h-1 w-3/4 rounded-full bg-black/50" />
          </div>
        </div>
      );
    case "editorial":
      return (
        <div className="m-2 flex w-12 items-center gap-1 border-y border-white/20 py-1.5">
          <div className="h-6 w-6 rounded-[1px] bg-white/25" />
          <div className="flex flex-1 flex-col gap-1">
            <div className="h-1 w-full rounded-full bg-white/40" />
            <div className="h-1 w-2/3 rounded-full bg-white/20" />
          </div>
        </div>
      );
    case "banner":
      return (
        <div className="relative m-2 w-14 self-center overflow-hidden rounded-[2px] bg-white/25 py-3">
          <div className="absolute bottom-1 left-1 h-1 w-8 rounded-full bg-white/70" />
        </div>
      );
    default:
      return null;
  }
}

export function CardsPanel({
  config,
  patch,
}: {
  config: StudioConfig;
  patch: PatchFn;
}) {
  const c = config.cards;
  const set = (p: Partial<StudioConfig["cards"]>) =>
    patch({ cards: { ...c, ...p } });

  // Only show controls the active variant actually honors — a control that
  // does nothing for the current card is a lie, not an option.
  const isList = c.variant === "minimal" || c.variant === "editorial";
  const hasFreeRatio = c.variant === "classic" || c.variant === "glass";
  const hasImages = c.variant !== "minimal";

  return (
    <PanelSection index="02" label="Item cards">
      <div className="grid grid-cols-2 gap-1.5">
        {CARD_VARIANTS.map((v) => (
          <OptionTile
            key={v.key}
            active={c.variant === v.key}
            label={v.label}
            hint={v.hint}
            onClick={() => set({ variant: v.key })}
          >
            <CardMockup variant={v.key} />
          </OptionTile>
        ))}
      </div>

      {!isList && (
        <Field label="Columns" inline>
          <Segmented
            size="sm"
            value={String(c.columns)}
            options={[
              { key: "1", label: "1" },
              { key: "2", label: "2" },
            ]}
            onChange={(v) => set({ columns: Number(v) })}
          />
        </Field>
      )}

      {hasFreeRatio && (
        <Field label="Image ratio" inline>
          <Segmented
            size="sm"
            value={c.imageRatio}
            options={[
              { key: "square" as const, label: "1:1" },
              { key: "portrait" as const, label: "3:4" },
              { key: "landscape" as const, label: "16:10" },
            ]}
            onChange={(v) => set({ imageRatio: v })}
          />
        </Field>
      )}

      <Field label="Price style">
        <Segmented
          size="sm"
          value={c.priceStyle}
          options={[
            { key: "plain" as const, label: "Plain" },
            { key: "badge" as const, label: "Badge" },
            { key: "dotted" as const, label: "Dotted" },
          ]}
          onChange={(v) => set({ priceStyle: v })}
        />
      </Field>

      {hasImages && (
        <Field label="Show photos" inline>
          <Toggle checked={c.showImages} onChange={(v) => set({ showImages: v })} />
        </Field>
      )}
      <Field label="Show descriptions" inline>
        <Toggle
          checked={c.showDescriptions}
          onChange={(v) => set({ showDescriptions: v })}
        />
      </Field>
      <Field label="Show tags" inline>
        <Toggle checked={c.showTags} onChange={(v) => set({ showTags: v })} />
      </Field>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 03 · HERO
// ─────────────────────────────────────────────────────────────────────────────
function HeroMockup({ preset }: { preset: string }) {
  switch (preset) {
    case "classic":
      return (
        <div className="m-2 flex w-16 flex-col items-center justify-center gap-1 rounded-[2px] bg-white/15 py-2">
          <div className="h-3 w-3 rounded-full bg-white/50" />
          <div className="h-1 w-8 rounded-full bg-white/60" />
          <div className="h-1 w-6 rounded-full bg-white/30" />
        </div>
      );
    case "editorial":
      return (
        <div className="m-2 flex w-16 flex-col justify-center gap-1 border-y border-white/25 px-1 py-2">
          <div className="h-1 w-4 rounded-full bg-white/30" />
          <div className="h-2 w-12 rounded-[1px] bg-white/60" />
          <div className="h-1 w-8 rounded-full bg-white/30" />
        </div>
      );
    case "poster":
      return (
        <div className="relative m-2 w-16 self-stretch overflow-hidden rounded-[2px] bg-white/30">
          <div className="absolute bottom-1 left-1 flex flex-col gap-0.5">
            <div className="h-1.5 w-10 rounded-full bg-white/80" />
            <div className="h-1 w-6 rounded-full bg-white/50" />
          </div>
        </div>
      );
    default:
      return null;
  }
}

export function HeroPanel({
  config,
  patch,
}: {
  config: StudioConfig;
  patch: PatchFn;
}) {
  const h = config.hero;
  const set = (p: Partial<StudioConfig["hero"]>) =>
    patch({ hero: { ...h, ...p } });

  return (
    <PanelSection index="03" label="Hero">
      <div className="grid grid-cols-3 gap-1.5">
        {HERO_PRESETS.map((v) => (
          <OptionTile
            key={v.key}
            active={h.preset === v.key}
            label={v.label}
            onClick={() => set({ preset: v.key })}
          >
            <HeroMockup preset={v.key} />
          </OptionTile>
        ))}
      </div>

      <Field label="Alignment" inline>
        <Segmented
          size="sm"
          value={h.alignment}
          options={[
            { key: "left" as const, label: "Left" },
            { key: "center" as const, label: "Center" },
          ]}
          onChange={(v) => set({ alignment: v })}
        />
      </Field>
      <Field label="Show logo" inline>
        <Toggle checked={h.showLogo} onChange={(v) => set({ showLogo: v })} />
      </Field>
      <Field label="Show tagline" inline>
        <Toggle
          checked={h.showTagline}
          onChange={(v) => set({ showTagline: v })}
        />
      </Field>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 04 · NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
export function NavPanel({
  config,
  patch,
}: {
  config: StudioConfig;
  patch: PatchFn;
}) {
  const n = config.nav;
  const set = (p: Partial<StudioConfig["nav"]>) =>
    patch({ nav: { ...n, ...p } });

  return (
    <PanelSection index="04" label="Category nav">
      <Field label="Style">
        <Segmented
          value={n.style}
          options={NAV_STYLES.map((s) => ({ key: s.key, label: s.label }))}
          onChange={(v) => set({ style: v })}
        />
      </Field>
      <Field label="Sticky while scrolling" inline>
        <Toggle checked={n.sticky} onChange={(v) => set({ sticky: v })} />
      </Field>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 05 · MOTION
// ─────────────────────────────────────────────────────────────────────────────
export function MotionPanel({
  config,
  patch,
  onReplay,
}: {
  config: StudioConfig;
  patch: PatchFn;
  onReplay: () => void;
}) {
  const m = config.motion;
  const set = (p: Partial<StudioConfig["motion"]>) =>
    patch({ motion: { ...m, ...p } });

  return (
    <PanelSection index="05" label="Motion · GSAP">
      <Field label="Animations" inline>
        <Toggle checked={m.enabled} onChange={(v) => set({ enabled: v })} />
      </Field>

      <Field label="Entrance">
        <Segmented
          size="sm"
          value={m.entrance}
          options={ENTRANCE_PRESETS.map((e) => ({ key: e.key, label: e.label }))}
          onChange={(v) => set({ entrance: v })}
        />
      </Field>

      <Field label="Hover">
        <Segmented
          size="sm"
          value={m.hover}
          options={HOVER_PRESETS.map((h) => ({ key: h.key, label: h.label }))}
          onChange={(v) => set({ hover: v })}
        />
      </Field>

      <Field label="Speed">
        <Slider
          value={m.speed}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(v) => set({ speed: v })}
          format={(v) => `${v.toFixed(1)}×`}
        />
      </Field>

      <Field label="Reveal on scroll" inline>
        <Toggle
          checked={m.scrollReveal}
          onChange={(v) => set({ scrollReveal: v })}
        />
      </Field>

      <button
        type="button"
        onClick={onReplay}
        disabled={!m.enabled || m.entrance === "none"}
        className="v-press mt-1 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-v-mut transition-colors hover:border-white/30 hover:text-v-ink disabled:opacity-40"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Replay entrance
      </button>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 06 · SECTIONS
// ─────────────────────────────────────────────────────────────────────────────
export function SectionsPanel({
  config,
  patch,
}: {
  config: StudioConfig;
  patch: PatchFn;
}) {
  const sections = config.sections;

  const move = (index: number, dir: -1 | 1) => {
    const next = [...sections];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ sections: next });
  };

  const toggle = (index: number, visible: boolean) => {
    const next = sections.map((s, i) => (i === index ? { ...s, visible } : s));
    patch({ sections: next });
  };

  return (
    <PanelSection index="06" label="Sections">
      <div className="flex flex-col gap-1">
        {sections.map((s, i) => {
          const meta = SECTION_META[s.id] ?? { label: s.id, hint: "" };
          return (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2.5 py-2"
            >
              <span className="font-v-mono text-[10px] text-v-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-none text-v-ink">
                  {meta.label}
                </p>
                {meta.hint && (
                  <p className="mt-0.5 truncate text-[10px] text-v-faint">
                    {meta.hint}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${meta.label} up`}
                className="v-press rounded-v p-1 text-v-faint transition-colors hover:text-v-ink disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === sections.length - 1}
                aria-label={`Move ${meta.label} down`}
                className="v-press rounded-v p-1 text-v-faint transition-colors hover:text-v-ink disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <Toggle checked={s.visible} onChange={(v) => toggle(i, v)} />
            </div>
          );
        })}
      </div>
    </PanelSection>
  );
}
