"use client";

import {
  PanelSection,
  Field,
  GInput,
  GTextArea,
  Toggle,
} from "../_studio/controls";
import { cn } from "@/lib/utils";
import { Layers, RotateCcw, Sparkles, Zap } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// CHAT — VolooAI widget theming, merged in from the old /dashboard/chat-theme
// page. Saves live into aiChatThemes; the preview pane renders the widget
// with these exact values.
// ─────────────────────────────────────────────────────────────────────────────

export type BgTemplate = "none" | "light_rays" | "flickering_grid";

export interface ChatThemeState {
  botName: string;
  greetingMessage: string;
  primaryColor: string;
  primaryColorLight: string;
  backgroundColor: string;
  textColor: string;
  userBubbleBg: string;
  userBubbleText: string;
  botBubbleBg: string;
  botBubbleText: string;
  backgroundTemplate: BgTemplate;
  isActive: boolean;
}

export const DEFAULT_CHAT_THEME: ChatThemeState = {
  botName: "",
  greetingMessage: "Hello! How can I help you today?",
  primaryColor: "#ea580c",
  primaryColorLight: "#f97316",
  backgroundColor: "#09090b",
  textColor: "#e4e4e7",
  userBubbleBg: "rgba(255,255,255,0.08)",
  userBubbleText: "#e4e4e7",
  botBubbleBg: "transparent",
  botBubbleText: "#a1a1aa",
  backgroundTemplate: "none",
  isActive: true,
};

const CHAT_PRESETS: { label: string; theme: Partial<ChatThemeState> }[] = [
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

/** Swatch + free-text input — chat colors allow rgba()/transparent values. */
function ColorTextField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 text-[13px] text-v-mut">
        {label}
        {hint && (
          <span className="mt-0.5 block text-[10px] text-v-faint">{hint}</span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <label
          className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-lg border border-white/15"
          style={{ backgroundColor: value || "#000" }}
        >
          <input
            type="color"
            value={isHex && value.length === 7 ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <GInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="w-[130px] px-2.5 py-1.5 font-v-mono text-[11px]"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

export function ChatPanel({
  chat,
  onChat,
  venueName,
}: {
  chat: ChatThemeState;
  onChat: (c: ChatThemeState) => void;
  venueName: string;
}) {
  const set = (p: Partial<ChatThemeState>) => onChat({ ...chat, ...p });

  return (
    <>
      <PanelSection index="01" label="Assistant">
        <Field label="Widget enabled" hint="Show VolooAI on your menu" inline>
          <Toggle checked={chat.isActive} onChange={(v) => set({ isActive: v })} />
        </Field>
        <Field label="Bot name">
          <GInput
            value={chat.botName}
            onChange={(e) => set({ botName: e.target.value })}
            placeholder={`${venueName} AI`}
          />
        </Field>
        <Field label="Greeting message" hint="First message visitors see">
          <GTextArea
            rows={2}
            value={chat.greetingMessage}
            onChange={(e) => set({ greetingMessage: e.target.value })}
            placeholder="Hello! How can I help you today?"
          />
        </Field>
      </PanelSection>

      <PanelSection index="02" label="Quick presets">
        <div className="flex flex-wrap gap-1.5">
          {CHAT_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => set(p.theme)}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-v-mut transition-all hover:bg-white/[0.08] hover:text-v-ink"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-white/25"
                style={{ backgroundColor: p.theme.primaryColor }}
              />
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              set({
                ...DEFAULT_CHAT_THEME,
                botName: chat.botName,
                greetingMessage: chat.greetingMessage,
                isActive: chat.isActive,
              })
            }
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-v-faint transition-all hover:text-v-ink"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
      </PanelSection>

      <PanelSection index="03" label="Brand colors">
        <ColorTextField
          label="Primary accent"
          hint="Buttons, avatar, highlights"
          value={chat.primaryColor}
          onChange={(v) => set({ primaryColor: v })}
        />
        <ColorTextField
          label="Accent light"
          hint="Gradients, bold AI text"
          value={chat.primaryColorLight}
          onChange={(v) => set({ primaryColorLight: v })}
        />
        <div
          className="h-1.5 rounded-full"
          style={{
            background: `linear-gradient(to right, ${chat.primaryColor}, ${chat.primaryColorLight})`,
          }}
        />
      </PanelSection>

      <PanelSection index="04" label="Surface">
        <ColorTextField
          label="Chat background"
          value={chat.backgroundColor}
          onChange={(v) => set({ backgroundColor: v })}
        />
        <ColorTextField
          label="Text color"
          value={chat.textColor}
          onChange={(v) => set({ textColor: v })}
        />
      </PanelSection>

      <PanelSection index="05" label="Message bubbles">
        <ColorTextField
          label="User bubble"
          hint="rgba() supported"
          value={chat.userBubbleBg}
          onChange={(v) => set({ userBubbleBg: v })}
        />
        <ColorTextField
          label="User text"
          value={chat.userBubbleText}
          onChange={(v) => set({ userBubbleText: v })}
        />
        <ColorTextField
          label="Bot text"
          value={chat.botBubbleText}
          onChange={(v) => set({ botBubbleText: v })}
        />
      </PanelSection>

      <PanelSection index="06" label="Background animation">
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              { id: "none", name: "Clean", icon: Layers },
              { id: "light_rays", name: "Rays", icon: Sparkles },
              { id: "flickering_grid", name: "Grid", icon: Zap },
            ] as const
          ).map((t) => {
            const active = chat.backgroundTemplate === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => set({ backgroundTemplate: t.id })}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-medium transition-all",
                  active
                    ? "border-v-accent/60 bg-v-accent/[0.10] text-v-accent ring-1 ring-v-accent/30"
                    : "border-white/10 bg-white/[0.04] text-v-mut hover:bg-white/[0.08] hover:text-v-ink",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.name}
              </button>
            );
          })}
        </div>
      </PanelSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChatPhonePreview — the themed widget inside the standard phone frame.
// ─────────────────────────────────────────────────────────────────────────────

function BgEffect({
  template,
  primaryColor,
}: {
  template: BgTemplate;
  primaryColor: string;
}) {
  if (template === "light_rays") {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-4 left-1/4 h-full w-20 -rotate-12 rounded-full opacity-15 blur-2xl"
          style={{ background: `linear-gradient(to bottom, ${primaryColor}, transparent)` }}
        />
        <div
          className="absolute -top-4 left-1/2 h-full w-12 rotate-6 rounded-full opacity-10 blur-xl"
          style={{ background: `linear-gradient(to bottom, ${primaryColor}, transparent)` }}
        />
        <div
          className="absolute -top-4 right-1/4 h-full w-14 -rotate-3 rounded-full opacity-[0.12] blur-2xl"
          style={{ background: `linear-gradient(to bottom, ${primaryColor}, transparent)` }}
        />
      </div>
    );
  }
  if (template === "flickering_grid") {
    // Deterministic pattern — no Math.random during render.
    const dots = Array.from({ length: 132 }, (_, i) => (i * 37) % 13);
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 grid gap-[3px] p-1"
          style={{ gridTemplateColumns: "repeat(12, 1fr)", gridTemplateRows: "repeat(11, 1fr)" }}
        >
          {dots.map((n, i) => (
            <div
              key={i}
              className="rounded-[1px]"
              style={{ backgroundColor: primaryColor, opacity: n < 3 ? 0.22 + n * 0.05 : 0.04 }}
            />
          ))}
        </div>
      </div>
    );
  }
  return null;
}

export function ChatPhonePreview({
  chat,
  venueName,
}: {
  chat: ChatThemeState;
  venueName: string;
}) {
  const botName = chat.botName || `${venueName} AI`;
  return (
    <div className="flex flex-col items-center gap-3">
      {!chat.isActive && (
        <span className="v-t-micro rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-2.5 py-1 text-amber-300 backdrop-blur">
          Widget disabled — diners won&apos;t see the assistant
        </span>
      )}
      <div className="rounded-[44px] border border-white/10 bg-black/60 p-2 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div
          className="relative flex flex-col overflow-hidden rounded-[36px]"
          style={{ width: 375, height: 720, backgroundColor: chat.backgroundColor }}
        >
          <BgEffect template={chat.backgroundTemplate} primaryColor={chat.primaryColor} />

          {/* Header */}
          <div
            className="relative z-10 flex items-center gap-3 border-b border-white/5 px-5 pb-3 pt-10"
            style={{ backgroundColor: `${chat.backgroundColor}eb`, backdropFilter: "blur(20px)" }}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl"
              style={{
                background: `linear-gradient(135deg, ${chat.primaryColor}33, ${chat.primaryColorLight}0d)`,
              }}
            >
              <Sparkles className="h-4 w-4" style={{ color: chat.primaryColorLight }} />
            </div>
            <div>
              <p className="text-[12px] font-black uppercase leading-none tracking-tight" style={{ color: chat.textColor }}>
                {botName}
              </p>
              <p className="mt-1 flex items-center gap-1 font-v-mono text-[9px] text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                Online
              </p>
            </div>
          </div>

          {/* Messages */}
          <div className="relative z-10 flex-1 space-y-5 overflow-hidden px-5 pt-5">
            <div className="flex flex-col gap-1">
              <div className="mb-0.5 flex items-center gap-1.5">
                <div
                  className="flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ background: `linear-gradient(135deg, ${chat.primaryColor}, ${chat.primaryColorLight})` }}
                >
                  <Sparkles className="h-2 w-2 text-white" />
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
                  {botName}
                </span>
              </div>
              <p className="pl-1 text-[12px] leading-relaxed" style={{ color: chat.botBubbleText }}>
                {chat.greetingMessage || "Hello! How can I help you today?"}
              </p>
            </div>

            <div className="flex justify-end">
              <div
                className="relative max-w-[75%] overflow-hidden rounded-[20px] rounded-br-sm px-3.5 py-2.5 text-[12px] leading-relaxed"
                style={{
                  backgroundColor: chat.userBubbleBg,
                  color: chat.userBubbleText,
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                Show me your coffee options
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="mb-0.5 flex items-center gap-1.5">
                <div
                  className="flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ background: `linear-gradient(135deg, ${chat.primaryColor}, ${chat.primaryColorLight})` }}
                >
                  <Sparkles className="h-2 w-2 text-white" />
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
                  {botName}
                </span>
              </div>
              <p className="pl-1 text-[12px] leading-relaxed" style={{ color: chat.botBubbleText }}>
                Our{" "}
                <strong style={{ color: chat.primaryColorLight }}>Flat White</strong>{" "}
                is the crowd favourite — double ristretto, silky microfoam.
              </p>
            </div>
          </div>

          {/* Input */}
          <div className="relative z-10 px-5 pb-10 pt-3" style={{ backgroundColor: `${chat.backgroundColor}cc` }}>
            <div
              className="flex h-12 items-center gap-3 rounded-full px-4"
              style={{ backgroundColor: chat.userBubbleBg, border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <span className="flex-1 text-[12px] opacity-40" style={{ color: chat.userBubbleText }}>
                Ask VolooAI…
              </span>
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: chat.primaryColor }}
              >
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </div>
            </div>
          </div>

          <div className="absolute bottom-3 left-1/2 z-20 h-1 w-20 -translate-x-1/2 rounded-full bg-white/20" />
        </div>
      </div>
    </div>
  );
}
