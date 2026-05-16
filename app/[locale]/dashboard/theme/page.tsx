"use client";

import { useState } from "react";
import {
  Palette,
  Smartphone,
  Save,
  Check,
  UtensilsCrossed,
  ShoppingCart,
  Star,
  Flame,
  Leaf,
  ChevronDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type FontFamily =
  | "Inter"
  | "Roboto"
  | "Playfair Display"
  | "DM Sans"
  | "Space Grotesk";

interface MenuTheme {
  backgroundColor: string;
  textColor: string;
  primaryButtonColor: string;
  itemBoxBackground: string;
  fontFamily: FontFamily;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT_OPTIONS: { value: FontFamily; label: string; className: string }[] = [
  { value: "Inter", label: "Inter", className: "font-sans" },
  { value: "Roboto", label: "Roboto", className: "font-sans" },
  { value: "Playfair Display", label: "Playfair Display", className: "font-serif" },
  { value: "DM Sans", label: "DM Sans", className: "font-sans" },
  { value: "Space Grotesk", label: "Space Grotesk", className: "font-sans" },
];

const DEFAULT_THEME: MenuTheme = {
  backgroundColor: "#0f0f0f",
  textColor: "#f5f5f5",
  primaryButtonColor: "#ffffff",
  itemBoxBackground: "#1a1a1a",
  fontFamily: "Inter",
};

const PRESETS = [
  {
    label: "Midnight",
    theme: {
      backgroundColor: "#0f0f0f",
      textColor: "#f5f5f5",
      primaryButtonColor: "#ffffff",
      itemBoxBackground: "#1a1a1a",
      fontFamily: "Inter" as FontFamily,
    },
  },
  {
    label: "Cream",
    theme: {
      backgroundColor: "#faf7f2",
      textColor: "#1a1008",
      primaryButtonColor: "#1a1008",
      itemBoxBackground: "#f0ebe0",
      fontFamily: "Playfair Display" as FontFamily,
    },
  },
  {
    label: "Forest",
    theme: {
      backgroundColor: "#0d1f12",
      textColor: "#e8f5e0",
      primaryButtonColor: "#4ade80",
      itemBoxBackground: "#142b1a",
      fontFamily: "DM Sans" as FontFamily,
    },
  },
  {
    label: "Ocean",
    theme: {
      backgroundColor: "#030d1a",
      textColor: "#e0f0ff",
      primaryButtonColor: "#38bdf8",
      itemBoxBackground: "#071728",
      fontFamily: "Space Grotesk" as FontFamily,
    },
  },
];

// ─── Color Control ────────────────────────────────────────────────────────────

function ColorControl({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-[11px] text-zinc-500 mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="relative h-9 w-9 rounded-lg border border-white/20 overflow-hidden cursor-pointer shrink-0 shadow-inner"
          style={{ backgroundColor: value }}
        >
          <input
            type="color"
            value={value.startsWith("#") ? value : "#ffffff"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-[88px] rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 focus:bg-white/8 transition-all"
          placeholder="#000000"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ─── Phone Mockup Preview ─────────────────────────────────────────────────────

function PhonePreview({ theme }: { theme: MenuTheme }) {
  const sampleItems = [
    {
      name: "Flat White",
      desc: "Double ristretto, steamed oat milk, velvety microfoam.",
      price: "5.50 ₾",
      tags: ["popular"],
      emoji: "☕",
    },
    {
      name: "Avocado Toast",
      desc: "Sourdough, smashed avo, chilli flakes, poached egg.",
      price: "12.00 ₾",
      tags: ["vegan"],
      emoji: "🥑",
    },
  ];

  return (
    <div
      className="relative mx-auto w-[300px] rounded-[2.5rem] border-[7px] border-zinc-700 shadow-2xl overflow-hidden"
      style={{ backgroundColor: theme.backgroundColor, fontFamily: theme.fontFamily }}
    >
      {/* Notch */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-zinc-700 rounded-b-2xl z-10" />

      {/* Screen */}
      <div className="overflow-y-auto max-h-[560px] scrollbar-none">
        {/* Header */}
        <div
          className="sticky top-0 z-20 px-5 pt-8 pb-4"
          style={{ backgroundColor: theme.backgroundColor }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p
                className="text-[10px] font-medium uppercase tracking-widest opacity-50"
                style={{ color: theme.textColor }}
              >
                Karabak Café
              </p>
              <h2
                className="text-lg font-bold leading-tight mt-0.5"
                style={{ color: theme.textColor }}
              >
                Our Menu
              </h2>
            </div>
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: theme.itemBoxBackground }}
            >
              <UtensilsCrossed
                className="h-4 w-4"
                style={{ color: theme.textColor, opacity: 0.6 }}
              />
            </div>
          </div>

          {/* Category chips */}
          <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-none pb-1">
            {["All", "Coffee", "Food", "Desserts"].map((cat, i) => (
              <span
                key={cat}
                className="text-[10px] font-medium px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 transition-all"
                style={
                  i === 0
                    ? {
                        backgroundColor: theme.primaryButtonColor,
                        color: theme.backgroundColor,
                      }
                    : {
                        backgroundColor: theme.itemBoxBackground,
                        color: theme.textColor,
                        opacity: 0.7,
                      }
                }
              >
                {cat}
              </span>
            ))}
          </div>
        </div>

        {/* Menu items */}
        <div className="px-4 pb-24 space-y-3">
          {sampleItems.map((item) => (
            <div
              key={item.name}
              className="rounded-2xl p-3.5 transition-all"
              style={{ backgroundColor: theme.itemBoxBackground }}
            >
              {/* Image placeholder */}
              <div
                className="w-full h-28 rounded-xl mb-3 flex items-center justify-center text-4xl"
                style={{
                  backgroundColor: theme.backgroundColor,
                  opacity: 0.8,
                }}
              >
                {item.emoji}
              </div>

              {/* Content */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p
                      className="text-sm font-semibold leading-tight"
                      style={{ color: theme.textColor }}
                    >
                      {item.name}
                    </p>
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: theme.primaryButtonColor,
                          color: theme.backgroundColor,
                          opacity: 0.9,
                        }}
                      >
                        {tag === "popular" ? "🔥" : "🌿"} {tag}
                      </span>
                    ))}
                  </div>
                  <p
                    className="text-[10px] mt-1 line-clamp-2 leading-relaxed opacity-60"
                    style={{ color: theme.textColor }}
                  >
                    {item.desc}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between mt-3">
                <p
                  className="text-base font-bold tabular-nums"
                  style={{ color: theme.textColor }}
                >
                  {item.price}
                </p>
                <button
                  className="flex items-center gap-1 text-[11px] font-semibold px-3.5 py-2 rounded-xl transition-all active:scale-95"
                  style={{
                    backgroundColor: theme.primaryButtonColor,
                    color: theme.backgroundColor,
                  }}
                >
                  <ShoppingCart className="h-3 w-3" />
                  Add
                </button>
              </div>
            </div>
          ))}

          {/* Footer order button */}
          <button
            className="w-full py-3.5 rounded-2xl text-sm font-bold mt-2 transition-all active:scale-[0.98]"
            style={{
              backgroundColor: theme.primaryButtonColor,
              color: theme.backgroundColor,
            }}
          >
            Send Order →
          </button>
        </div>
      </div>

      {/* Home indicator */}
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-20 h-1 rounded-full bg-white/20" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ThemeCustomizerPage() {
  const [theme, setTheme] = useState<MenuTheme>(DEFAULT_THEME);
  const [saved, setSaved] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>("Midnight");

  function update<K extends keyof MenuTheme>(key: K, value: MenuTheme[K]) {
    setTheme((t) => ({ ...t, [key]: value }));
    setActivePreset(null);
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setTheme(preset.theme);
    setActivePreset(preset.label);
  }

  function handleSave() {
    console.log("💾 [ThemeCustomizer] Saving theme to Convex:", theme);
    // TODO: await useMutation(api.organizations.updateThemeSettings)({ orgId, themeSettings: theme });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
        <div className="flex items-center gap-2 mb-1">
          <Palette className="h-4 w-4 text-white" />
          <h1 className="text-3xl font-medium tracking-tight text-white">
            Live Theme Customizer
          </h1>
        </div>
        <p className="text-sm text-zinc-400">
          Design your customer-facing menu PWA. Changes preview instantly on the
          right.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

        {/* ── LEFT: Controls ──────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Preset chips */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Quick Presets
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-medium transition-all ${
                    activePreset === preset.label
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-full border border-white/20 shrink-0"
                    style={{ backgroundColor: preset.theme.primaryButtonColor }}
                  />
                  {preset.label}
                  {activePreset === preset.label && (
                    <Check className="h-3 w-3 ml-0.5" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Color controls */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">
              Colors
            </p>

            <ColorControl
              label="Background"
              description="The screen's base color"
              value={theme.backgroundColor}
              onChange={(v) => update("backgroundColor", v)}
            />
            <ColorControl
              label="Text Color"
              description="Headings, prices, descriptions"
              value={theme.textColor}
              onChange={(v) => update("textColor", v)}
            />
            <ColorControl
              label="Primary Button"
              description="CTA buttons and active chips"
              value={theme.primaryButtonColor}
              onChange={(v) => update("primaryButtonColor", v)}
            />
            <ColorControl
              label="Item Box"
              description="Menu card background (supports rgba)"
              value={theme.itemBoxBackground}
              onChange={(v) => update("itemBoxBackground", v)}
            />
          </div>

          {/* Font family */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Typography
            </p>
            <div className="relative">
              <select
                value={theme.fontFamily}
                onChange={(e) =>
                  update("fontFamily", e.target.value as FontFamily)
                }
                className="w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-10 text-sm text-white focus:outline-none focus:border-white/30 focus:bg-white/8 transition-all cursor-pointer"
              >
                {FONT_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    className="bg-zinc-900 text-white"
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            </div>

            {/* Font preview row */}
            <div className="mt-3 flex flex-wrap gap-2">
              {FONT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => update("fontFamily", opt.value)}
                  className={`px-3 py-2 rounded-xl border text-xs transition-all ${
                    theme.fontFamily === opt.value
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 bg-white/[0.02] text-zinc-500 hover:text-white hover:bg-white/5"
                  }`}
                  style={{ fontFamily: opt.value }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Live config readout */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Generated Config
            </p>
            <pre className="text-[10px] font-mono text-zinc-400 leading-relaxed overflow-x-auto">
              {JSON.stringify(theme, null, 2)}
            </pre>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-all duration-300 ${
              saved
                ? "bg-white/15 text-white border border-white/20"
                : "bg-white text-black hover:bg-zinc-200"
            }`}
          >
            {saved ? (
              <>
                <Check className="h-4 w-4 text-white" />
                Theme Saved!
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Theme
              </>
            )}
          </button>
          <p className="text-[10px] text-zinc-600 text-center -mt-2">
            Ready to connect to{" "}
            <code className="font-mono text-zinc-500">
              organizations.updateThemeSettings
            </code>
          </p>
        </div>

        {/* ── RIGHT: Live Preview ──────────────────────────────────────────── */}
        <div className="xl:sticky xl:top-6">
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <Smartphone className="h-4 w-4 text-zinc-400" />
              <p className="text-sm font-medium text-white">Live Preview</p>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-500 border border-white/10 rounded-full px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                Real-time
              </span>
            </div>
            <PhonePreview theme={theme} />
            <p className="text-center text-[10px] text-zinc-600 mt-4">
              Font:{" "}
              <span className="text-zinc-400 font-medium">{theme.fontFamily}</span>
              {" · "}
              BG:{" "}
              <span className="font-mono text-zinc-400">{theme.backgroundColor}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
