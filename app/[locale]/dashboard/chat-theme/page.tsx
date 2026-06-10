"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@clerk/nextjs";
import {
  Check,
  Save,
  MessageSquare,
  Sparkles,
  Zap,
  Layers,
  RotateCcw,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type BgTemplate = "none" | "light_rays" | "flickering_grid";

interface ChatTheme {
  primaryColor: string;
  primaryColorLight: string;
  backgroundColor: string;
  textColor: string;
  userBubbleBg: string;
  userBubbleText: string;
  botBubbleBg: string;
  botBubbleText: string;
  backgroundTemplate: BgTemplate;
}

const DEFAULT: ChatTheme = {
  primaryColor: "#ea580c",
  primaryColorLight: "#f97316",
  backgroundColor: "#09090b",
  textColor: "#e4e4e7",
  userBubbleBg: "rgba(255,255,255,0.08)",
  userBubbleText: "#e4e4e7",
  botBubbleBg: "transparent",
  botBubbleText: "#a1a1aa",
  backgroundTemplate: "none",
};

const BG_TEMPLATES: { id: BgTemplate; name: string; desc: string }[] = [
  { id: "none", name: "Clean", desc: "No animation" },
  { id: "light_rays", name: "Light Rays", desc: "Soft animated god-rays" },
  { id: "flickering_grid", name: "Grid", desc: "Subtle flickering dot grid" },
];

// ─── ColorControl ─────────────────────────────────────────────────────────────

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
  const isValid = value.startsWith("#") && (value.length === 4 || value.length === 7);
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-[11px] text-zinc-500 mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="relative h-9 w-9 rounded-lg border border-white/20 overflow-hidden cursor-pointer shrink-0"
          style={{ backgroundColor: isValid ? value : "#ffffff" }}
        >
          <input
            type="color"
            value={isValid ? value : "#ffffff"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-[92px] rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30 transition-all"
          placeholder="#000000"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ─── Chat Preview ─────────────────────────────────────────────────────────────

function BgEffect({ template, primaryColor }: { template: BgTemplate; primaryColor: string }) {
  if (template === "light_rays") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-4 left-1/4 w-16 h-full opacity-15 blur-2xl rounded-full -rotate-12"
          style={{ background: `linear-gradient(to bottom, ${primaryColor}, transparent)` }} />
        <div className="absolute -top-4 left-1/2 w-10 h-full opacity-10 blur-xl rounded-full rotate-6"
          style={{ background: `linear-gradient(to bottom, ${primaryColor}, transparent)` }} />
        <div className="absolute -top-4 right-1/4 w-12 h-full opacity-12 blur-2xl rounded-full -rotate-3"
          style={{ background: `linear-gradient(to bottom, ${primaryColor}, transparent)` }} />
      </div>
    );
  }
  if (template === "flickering_grid") {
    const dots = Array.from({ length: 120 });
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 grid gap-[3px] p-1"
          style={{ gridTemplateColumns: "repeat(12, 1fr)", gridTemplateRows: "repeat(10, 1fr)" }}>
          {dots.map((_, i) => (
            <div key={i} className="rounded-[1px]"
              style={{ backgroundColor: primaryColor, opacity: Math.random() < 0.25 ? 0.2 + Math.random() * 0.15 : 0.04 }} />
          ))}
        </div>
      </div>
    );
  }
  return null;
}

function ChatPreview({ theme }: { theme: ChatTheme }) {
  return (
    <div
      className="relative mx-auto w-[300px] rounded-[2.5rem] border-[7px] border-zinc-700 shadow-2xl overflow-hidden flex flex-col"
      style={{ backgroundColor: theme.backgroundColor, height: 560 }}
    >
      {/* Notch */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-zinc-700 rounded-b-2xl z-20" />

      {/* Background effect */}
      <BgEffect template={theme.backgroundTemplate} primaryColor={theme.primaryColor} />

      {/* Header */}
      <div className="relative z-10 px-4 pt-8 pb-3 flex items-center gap-3 border-b border-white/5"
        style={{ backgroundColor: `${theme.backgroundColor}eb`, backdropFilter: "blur(20px)" }}>
        <div className="w-8 h-8 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${theme.primaryColor}33, ${theme.primaryColorLight}0d)` }}>
          <Sparkles className="w-4 h-4" style={{ color: theme.primaryColorLight }} />
        </div>
        <div>
          <p className="text-[11px] font-black uppercase tracking-tight leading-none text-zinc-100">Noir Cafe AI</p>
          <p className="text-[9px] font-mono flex items-center gap-1 mt-0.5 text-zinc-500">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
            Online
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="relative z-10 flex-1 overflow-hidden px-4 pt-4 pb-2 space-y-4">
        {/* Bot message */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="w-4 h-4 rounded-full flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColorLight})` }}>
              <Sparkles className="w-2 h-2 text-white" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Noir Cafe AI</span>
          </div>
          <p className="text-[11px] leading-relaxed pl-1" style={{ color: theme.botBubbleText }}>
            Welcome! I can help you explore our menu. What are you in the mood for?
          </p>
        </div>

        {/* User message */}
        <div className="flex justify-end">
          <div className="max-w-[75%] px-3 py-2 rounded-[20px] rounded-br-sm text-[11px] leading-relaxed relative overflow-hidden"
            style={{
              backgroundColor: theme.userBubbleBg,
              color: theme.userBubbleText,
              border: "1px solid rgba(255,255,255,0.12)",
            }}>
            Show me your coffee options
          </div>
        </div>

        {/* Bot reply */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="w-4 h-4 rounded-full flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColorLight})` }}>
              <Sparkles className="w-2 h-2 text-white" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Noir Cafe AI</span>
          </div>
          <p className="text-[11px] leading-relaxed pl-1" style={{ color: theme.botBubbleText }}>
            Our <strong style={{ color: theme.primaryColorLight }}>Flat White</strong> is the crowd favourite — double ristretto, silky oat milk microfoam.
          </p>
        </div>
      </div>

      {/* Input */}
      <div className="relative z-10 px-4 pb-8 pt-2" style={{ backgroundColor: `${theme.backgroundColor}cc` }}>
        <div className="h-11 rounded-full flex items-center px-4 gap-3"
          style={{ backgroundColor: theme.userBubbleBg, border: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="text-[11px] flex-1 opacity-40" style={{ color: theme.userBubbleText }}>Ask VolooAI…</span>
          <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: theme.primaryColor }}>
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </div>
        </div>
      </div>

      {/* Home indicator */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-20 h-1 rounded-full bg-white/20 z-20" />
    </div>
  );
}

// ─── Preset chips ─────────────────────────────────────────────────────────────

const PRESETS: { label: string; theme: Partial<ChatTheme> }[] = [
  {
    label: "Noir",
    theme: {
      primaryColor: "#ea580c", primaryColorLight: "#f97316",
      backgroundColor: "#09090b", textColor: "#e4e4e7",
      userBubbleBg: "rgba(255,255,255,0.08)", userBubbleText: "#e4e4e7",
      botBubbleBg: "transparent", botBubbleText: "#a1a1aa",
    },
  },
  {
    label: "Midnight",
    theme: {
      primaryColor: "#6366f1", primaryColorLight: "#818cf8",
      backgroundColor: "#0d0e1a", textColor: "#e0e7ff",
      userBubbleBg: "rgba(99,102,241,0.15)", userBubbleText: "#e0e7ff",
      botBubbleBg: "transparent", botBubbleText: "#94a3b8",
    },
  },
  {
    label: "Forest",
    theme: {
      primaryColor: "#22c55e", primaryColorLight: "#4ade80",
      backgroundColor: "#0a1a0d", textColor: "#dcfce7",
      userBubbleBg: "rgba(34,197,94,0.12)", userBubbleText: "#dcfce7",
      botBubbleBg: "transparent", botBubbleText: "#86efac",
    },
  },
  {
    label: "Rose",
    theme: {
      primaryColor: "#f43f5e", primaryColorLight: "#fb7185",
      backgroundColor: "#110810", textColor: "#ffe4e6",
      userBubbleBg: "rgba(244,63,94,0.12)", userBubbleText: "#ffe4e6",
      botBubbleBg: "transparent", botBubbleText: "#fda4af",
    },
  },
  {
    label: "Ocean",
    theme: {
      primaryColor: "#0ea5e9", primaryColorLight: "#38bdf8",
      backgroundColor: "#030d1a", textColor: "#e0f2fe",
      userBubbleBg: "rgba(14,165,233,0.12)", userBubbleText: "#e0f2fe",
      botBubbleBg: "transparent", botBubbleText: "#7dd3fc",
    },
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChatThemePage() {
  const { organization } = useOrganization();
  const existingTheme = useQuery(api.aiChatThemes.get, { orgId: organization?.id });
  const updateThemeMutation = useMutation(api.aiChatThemes.update);

  const [theme, setTheme] = useState<ChatTheme>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>("Noir");

  useEffect(() => {
    if (existingTheme) {
      setTheme({
        primaryColor: existingTheme.primaryColor || DEFAULT.primaryColor,
        primaryColorLight: existingTheme.textColor !== DEFAULT.textColor
          ? existingTheme.primaryColor || DEFAULT.primaryColorLight
          : DEFAULT.primaryColorLight,
        backgroundColor: existingTheme.backgroundColor || DEFAULT.backgroundColor,
        textColor: existingTheme.textColor || DEFAULT.textColor,
        userBubbleBg: existingTheme.userMessageBg || DEFAULT.userBubbleBg,
        userBubbleText: existingTheme.userMessageText || DEFAULT.userBubbleText,
        botBubbleBg: existingTheme.botMessageBg || DEFAULT.botBubbleBg,
        botBubbleText: existingTheme.botMessageText || DEFAULT.botBubbleText,
        backgroundTemplate: (existingTheme.backgroundTemplate || "none") as BgTemplate,
      });
      setActivePreset(null);
    }
  }, [existingTheme]);

  function update<K extends keyof ChatTheme>(key: K, value: ChatTheme[K]) {
    setTheme((t) => ({ ...t, [key]: value }));
    setActivePreset(null);
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    setTheme((t) => ({ ...t, ...preset.theme }));
    setActivePreset(preset.label);
  }

  async function handleSave() {
    if (!organization?.id) return;
    setSaving(true);
    try {
      await updateThemeMutation({
        orgId: organization.id,
        botName: existingTheme?.botName || "AI Assistant",
        botAvatarUrl: existingTheme?.botAvatarUrl || "",
        primaryColor: theme.primaryColor,
        backgroundColor: theme.backgroundColor,
        textColor: theme.textColor,
        userMessageBg: theme.userBubbleBg,
        userMessageText: theme.userBubbleText,
        botMessageBg: theme.botBubbleBg,
        botMessageText: theme.botBubbleText,
        fontFamily: existingTheme?.fontFamily || "Inter",
        backgroundTemplate: theme.backgroundTemplate === "none" ? undefined : theme.backgroundTemplate,
        greetingMessage: existingTheme?.greetingMessage || "Hello! How can I help you today?",
        isActive: true,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquare className="h-5 w-5 text-white" />
          <h1 className="text-3xl font-medium tracking-tight text-white">AI Chat Theme</h1>
        </div>
        <p className="text-sm text-zinc-400">
          Fully customise your AI chat widget. Changes preview live on the right.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

        {/* ── LEFT: Controls ──────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Quick Presets */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">Quick Presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-medium transition-all ${
                    activePreset === p.label
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span className="h-3 w-3 rounded-full border border-white/20 shrink-0"
                    style={{ backgroundColor: p.theme.primaryColor }} />
                  {p.label}
                  {activePreset === p.label && <Check className="h-3 w-3 ml-0.5" />}
                </button>
              ))}
              <button
                onClick={() => { setTheme(DEFAULT); setActivePreset("Noir"); }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-zinc-500 text-xs hover:text-white hover:bg-white/5 transition-all"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
          </div>

          {/* Brand Colors */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">Brand Colours</p>
            <ColorControl label="Primary Accent" description="Buttons, AI avatar gradient, highlights" value={theme.primaryColor} onChange={(v) => update("primaryColor", v)} />
            <ColorControl label="Accent Light" description="Hover states, bold text in AI messages" value={theme.primaryColorLight} onChange={(v) => update("primaryColorLight", v)} />
            {/* Live accent preview */}
            <div className="mt-3 h-1.5 rounded-full overflow-hidden"
              style={{ background: `linear-gradient(to right, ${theme.primaryColor}, ${theme.primaryColorLight})` }} />
          </div>

          {/* Background */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">Background</p>
            <ColorControl label="Chat Background" description="Full-screen chat container color" value={theme.backgroundColor} onChange={(v) => update("backgroundColor", v)} />
            <ColorControl label="Text Color" description="General body text" value={theme.textColor} onChange={(v) => update("textColor", v)} />
          </div>

          {/* Message Bubbles */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">Message Bubbles</p>
            <ColorControl label="User Bubble BG" description="Your customers' message background" value={theme.userBubbleBg} onChange={(v) => update("userBubbleBg", v)} />
            <ColorControl label="User Bubble Text" description="Your customers' message text" value={theme.userBubbleText} onChange={(v) => update("userBubbleText", v)} />
            <ColorControl label="Bot Text Color" description="AI response text color" value={theme.botBubbleText} onChange={(v) => update("botBubbleText", v)} />
          </div>

          {/* Background Animation */}
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">Background Animation</p>
            <div className="grid grid-cols-3 gap-2">
              {BG_TEMPLATES.map((t) => {
                const isActive = theme.backgroundTemplate === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => update("backgroundTemplate", t.id)}
                    className={`relative flex flex-col items-center justify-center h-20 rounded-xl border text-center transition-all text-xs ${
                      isActive
                        ? "border-orange-500 bg-orange-500/10 text-orange-400"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {t.id === "none" && <Layers className="h-4 w-4 mb-1.5" />}
                    {t.id === "light_rays" && <Sparkles className="h-4 w-4 mb-1.5" />}
                    {t.id === "flickering_grid" && <Zap className="h-4 w-4 mb-1.5" />}
                    <span className="font-semibold text-[11px]">{t.name}</span>
                    <span className="text-[9px] opacity-60 mt-0.5">{t.desc}</span>
                    {isActive && (
                      <div className="absolute top-1.5 right-1.5 h-4 w-4 bg-orange-500 rounded-full flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-all duration-300 ${
              saved
                ? "bg-white/10 text-white border border-white/20"
                : "bg-white text-black hover:bg-zinc-200"
            } disabled:opacity-50`}
          >
            {saved ? (
              <><Check className="h-4 w-4" /> Applied to storefront!</>
            ) : saving ? (
              <><Save className="h-4 w-4 animate-bounce" /> Saving…</>
            ) : (
              <><Save className="h-4 w-4" /> Save Chat Theme</>
            )}
          </button>
        </div>

        {/* ── RIGHT: Live Preview ──────────────────────────────────────────── */}
        <div className="xl:sticky xl:top-6">
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <MessageSquare className="h-4 w-4 text-zinc-400" />
              <p className="text-sm font-medium text-white">Live Preview</p>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-500 border border-white/10 rounded-full px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                Real-time
              </span>
            </div>
            <ChatPreview theme={theme} />
            <p className="text-center text-[10px] text-zinc-600 mt-4">
              Template:{" "}
              <span className="text-zinc-400 font-medium">{theme.backgroundTemplate}</span>
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
