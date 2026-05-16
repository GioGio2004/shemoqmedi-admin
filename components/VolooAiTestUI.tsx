"use client";
// components/VolooAiTestUI.tsx — Voice + Chat orchestrator
// Toggle button switches between the Gemini Live voice agent and the
// Gemini 2.5 Flash text chat interface.

import { useState, useCallback, useEffect, useRef } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useGeminiLive, type LiveStatus, type ShowcaseItem, type ThemeUpdate } from "@/hooks/useGeminiLive";
import { ShowcaseCard } from "@/components/VolooShowcaseCard";
import VolooChatUI from "@/components/VolooChatUI";

const TOOL_ICON: Record<string, string> = {
  toggle_menu_item: "⚡",
  query_menu: "🔍",
  showcase_on_screen: "📺",
  update_description: "✏️",
  update_storefront_theme: "🎨",
  broadcast_storefront_alert: "📣",
};

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<LiveStatus, { label: string; sub: string; color: string; glow: string }> = {
  disconnected: { label: "Offline", sub: "Tap to connect", color: "rgba(255,255,255,0.15)", glow: "none" },
  connecting: { label: "Connecting…", sub: "Opening secure channel", color: "rgba(255,255,255,0.4)", glow: "none" },
  listening: { label: "Listening", sub: "Speak naturally", color: "#ffffff", glow: "0 0 32px 8px rgba(255,255,255,0.18)" },
  speaking: { label: "Speaking", sub: "VolooAI is responding", color: "#ffffff", glow: "0 0 40px 12px rgba(255,255,255,0.25)" },
};

// ── Mode toggle pill ──────────────────────────────────────────────────────────
function ModeToggle({ mode, onChange }: { mode: "voice" | "chat"; onChange: (m: "voice" | "chat") => void }) {
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/4 p-1 backdrop-blur-sm">
      {(["voice", "chat"] as const).map((m) => (
        <button
          key={m}
          id={`voloo-mode-${m}`}
          onClick={() => onChange(m)}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${
            mode === m
              ? "bg-white text-black shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {m === "voice" ? (
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 15 6.7 12H5c0 3.42 2.72 6.23 6 6.72V22h2v-3.28c3.28-.49 6-3.3 6-6.72h-1.7z"/>
            </svg>
          ) : (
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
          )}
          {m}
        </button>
      ))}
    </div>
  );
}

// ── Voice orb ─────────────────────────────────────────────────────────────────
function VoiceOrb({ status, onToggle, disabled }: { status: LiveStatus; onToggle: () => void; disabled: boolean }) {
  const cfg = STATUS_CFG[status];
  const isLive = status === "listening" || status === "speaking";
  return (
    <div className="flex flex-col items-center gap-4">
      <button id="voloo-live-toggle-btn" onClick={onToggle} disabled={disabled}
        aria-label={isLive ? "Disconnect VolooAI" : "Connect VolooAI"}
        style={{ WebkitTapHighlightColor: "transparent" }}
        className="relative flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-full">
        {isLive && (
          <>
            <span className="absolute h-40 w-40 rounded-full border border-white/10 animate-ping" style={{ animationDuration: "1.8s" }} />
            <span className="absolute h-56 w-56 rounded-full border border-white/6 animate-ping" style={{ animationDuration: "2.4s", animationDelay: "0.6s" }} />
          </>
        )}
        <div className="relative h-32 w-32 rounded-full flex items-center justify-center transition-transform duration-200 active:scale-95"
          style={{ background: isLive ? "radial-gradient(circle at 40% 35%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 70%)" : "radial-gradient(circle at 40% 35%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 70%)", border: `1.5px solid ${cfg.color}`, boxShadow: cfg.glow, backdropFilter: "blur(20px)" }}>
          {status === "speaking" ? (
            <div className="flex items-end gap-[3px] h-8">
              {[0.4, 0.8, 1, 0.7, 0.9, 0.5, 0.75].map((h, i) => (
                <div key={i} className="w-[3px] rounded-full bg-white animate-bounce"
                  style={{ height: `${h * 100}%`, animationDelay: `${i * 0.07}s`, animationDuration: "0.5s" }} />
              ))}
            </div>
          ) : (
            <svg className="h-9 w-9" style={{ color: cfg.color }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 15 6.7 12H5c0 3.42 2.72 6.23 6 6.72V22h2v-3.28c3.28-.49 6-3.3 6-6.72h-1.7z" />
            </svg>
          )}
          {isLive && <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-white animate-pulse" />}
        </div>
      </button>
      <div className="text-center">
        <p className="text-[13px] font-semibold text-white tracking-wide">{cfg.label}</p>
        <p className="text-[11px] text-zinc-500 mt-0.5">{cfg.sub}</p>
      </div>
    </div>
  );
}

// ── Tool log row ──────────────────────────────────────────────────────────────
function LogRow({ entry }: { entry: { id: string; ts: string; tool: string; detail: string; success: boolean } }) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-base mt-0.5 shrink-0">{TOOL_ICON[entry.tool] ?? "🔧"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${entry.success ? "text-white/70" : "text-rose-400"}`}>
            {entry.tool.replace(/_/g, " ")}
          </span>
          <span className="ml-auto text-[9px] text-zinc-700 font-mono shrink-0">{entry.ts}</span>
        </div>
        <p className="text-[11px] text-zinc-600 mt-0.5 truncate">{entry.detail}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VolooAiTestUI() {
  const { organization } = useOrganization();
  const orgId = organization?.id ?? "";

  const [mode, setMode] = useState<"voice" | "chat">("voice");
  const [showcasedItems, setShowcasedItems] = useState<ShowcaseItem[] | null>(null);
  const [themeToast, setThemeToast] = useState<(ThemeUpdate & { visible: boolean }) | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleShowcase = useCallback((items: ShowcaseItem[]) => setShowcasedItems(items), []);
  const handleThemeUpdate = useCallback((theme: ThemeUpdate) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setThemeToast({ ...theme, visible: true });
    toastTimer.current = setTimeout(() => setThemeToast(null), 5000);
  }, []);

  const { status, error, actionLog, connect, disconnect } = useGeminiLive({ onShowcase: handleShowcase, onThemeUpdate: handleThemeUpdate });

  useEffect(() => () => { disconnect(); if (toastTimer.current) clearTimeout(toastTimer.current); }, [disconnect]);

  const isLive = status === "listening" || status === "speaking";

  const handleToggle = useCallback(() => {
    if (status === "disconnected") connect(orgId);
    else disconnect();
  }, [status, orgId, connect, disconnect]);

  // Disconnect voice when switching to chat
  const handleModeChange = useCallback((m: "voice" | "chat") => {
    if (m === "chat" && isLive) disconnect();
    setMode(m);
  }, [isLive, disconnect]);

  const handleSaved = useCallback((itemId: string, newDesc: string) => {
    setShowcasedItems(prev => prev ? prev.map(i => i.id === itemId ? { ...i, description: newDesc } : i) : prev);
  }, []);

  return (
    <div className="flex flex-col h-full w-full">

      {/* ── CHAT MODE — fills full height ────────────────────────────── */}
      {mode === "chat" && orgId && (
        <div className="flex flex-col h-full relative">
          {/* Floating mode toggle inside chat */}
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10">
            <ModeToggle mode={mode} onChange={handleModeChange} />
          </div>
          <VolooChatUI orgId={orgId} orgName={organization?.name} />
        </div>
      )}

      {/* ── VOICE MODE — scrollable card layout ──────────────────────── */}
      {mode === "voice" && (
        <div className="overflow-y-auto flex-1">
          <div className="flex flex-col gap-5 w-full max-w-2xl mx-auto px-4 py-6 pb-28 lg:pb-8">

            {/* Mode toggle */}
            <div className="flex justify-center">
              <ModeToggle mode={mode} onChange={handleModeChange} />
            </div>
          {/* Main voice card */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#09090b]/80 backdrop-blur-2xl shadow-2xl">
            <div className={`absolute top-0 inset-x-0 h-px transition-colors duration-700 ${status === "speaking" ? "bg-white" : status === "listening" ? "bg-white/60" : "bg-white/15"}`} />
            <div className="flex flex-col items-center gap-8 px-6 pt-10 pb-8">
              {organization && (
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">VolooAI · Voice</p>
                  <p className="text-sm font-semibold text-white mt-1">{organization.name}</p>
                </div>
              )}
              <VoiceOrb status={status} onToggle={handleToggle} disabled={status === "connecting"} />
              {error && (
                <div className="w-full rounded-2xl border border-white/8 bg-white/3 px-4 py-3 text-center">
                  <p className="text-xs font-semibold text-white/60">⚠ {error}</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Open DevTools → Console for details</p>
                </div>
              )}
              {status === "disconnected" && (
                <div className="w-full space-y-1.5">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-700 text-center mb-2">Try saying</p>
                  {['"What items are hidden?"', '"Announce kitchen is 15 min late"', '"Change the theme to Forest"'].map(cmd => (
                    <div key={cmd} className="rounded-xl border border-white/5 bg-white/2 px-3 py-2 text-center">
                      <span className="text-[11px] text-zinc-600 font-mono">{cmd}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tool log */}
          {actionLog.length > 0 && (
            <div className="rounded-2xl border border-white/8 bg-[#09090b]/60 backdrop-blur-sm overflow-hidden">
              <button onClick={() => setLogOpen(o => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/3 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Tool Log</span>
                  <span className="flex items-center justify-center h-4 w-4 rounded-full bg-white/8 text-[9px] font-bold text-zinc-400">{actionLog.length}</span>
                </div>
                <span className={`text-zinc-600 text-xs transition-transform duration-200 ${logOpen ? "rotate-180" : ""}`}>▾</span>
              </button>
              {logOpen && (
                <div className="max-h-56 overflow-y-auto border-t border-white/6">
                  {actionLog.map(e => <LogRow key={e.id} entry={e} />)}
                </div>
              )}
            </div>
          )}

          {/* Showcase grid */}
          {showcasedItems !== null && (
            <div style={{ animation: "fadeUp 0.3s ease both" }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">On Screen</p>
                  <p className="text-base font-bold text-white mt-0.5">{showcasedItems.length} Item{showcasedItems.length !== 1 ? "s" : ""}</p>
                </div>
                <button onClick={() => setShowcasedItems(null)}
                  className="text-[11px] text-zinc-600 hover:text-zinc-400 border border-white/8 rounded-xl px-3 py-1.5 transition-colors">
                  Dismiss
                </button>
              </div>
              {showcasedItems.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/2 px-6 py-10 text-center">
                  <p className="text-zinc-500 text-sm">No items matched.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {showcasedItems.map((item, i) => (
                    <div key={`${item.id ?? item.name}-${i}`} style={{ animationDelay: `${i * 50}ms`, animation: "fadeUp 0.3s ease both" }}>
                      <ShowcaseCard item={item} orgId={orgId} onSaved={handleSaved} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      )}

      {/* ── Theme toast (both modes) ─────────────────────────────────────── */}
      {themeToast && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 z-50 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#09090b]/95 backdrop-blur-xl shadow-2xl"
          style={{ animation: "fadeUp 0.3s ease both" }}>
          <div className="flex items-start gap-3 px-4 py-3.5">
            <span className="text-lg mt-0.5">🎨</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white">Storefront Updated</p>
              <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1.5">
                {(Object.entries(themeToast) as [string, string | boolean][])
                  .filter(([k, v]) => k !== "visible" && v !== undefined)
                  .map(([key, value]) => {
                    const isColor = typeof value === "string" && value.startsWith("#");
                    return (
                      <div key={key} className="flex items-center gap-1">
                        {isColor && <span className="h-3 w-3 rounded-full border border-white/15 shrink-0" style={{ backgroundColor: value as string }} />}
                        <span className="text-[10px] text-zinc-400 font-mono">{key.replace(/([A-Z])/g, " $1").toLowerCase()}: {String(value)}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
            <button onClick={() => setThemeToast(null)} className="text-zinc-600 hover:text-zinc-300 text-sm mt-0.5 transition-colors">✕</button>
          </div>
          <div className="h-[2px] bg-white/5">
            <div className="h-full origin-left bg-white/30" style={{ animation: "drainBar 5s linear forwards" }} />
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes drainBar {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
}
