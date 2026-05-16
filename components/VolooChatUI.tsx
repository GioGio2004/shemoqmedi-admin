"use client";
// components/VolooChatUI.tsx — Full-height VolooAI text chat
// Showcase cards appear inline as chat message bubbles, not below the chat.

import { useState, useRef, useEffect, useCallback } from "react";
import { useVolooChat } from "@/hooks/useVolooChat";
import { ShowcaseCard } from "@/components/VolooShowcaseCard";
import type { ShowcaseItem } from "@/hooks/useGeminiLive";

const TOOL_ICON: Record<string, string> = {
  toggle_menu_item: "⚡",
  query_menu: "🔍",
  showcase_on_screen: "📺",
  update_description: "✏️",
  update_storefront_theme: "🎨",
  broadcast_storefront_alert: "📣",
};

const SUGGESTIONS = [
  "What items are hidden?",
  "Announce kitchen is 15 min late",
  "Change the theme to dark forest",
  "Show me all coffee items",
];

// ── Per-message showcase cards (inline in the chat thread) ───────────────────
function InlineShowcase({ items, orgId }: { items: ShowcaseItem[]; orgId: string }) {
  if (items.length === 0) {
    return (
      <div className="mt-2 rounded-2xl border border-white/8 bg-white/2 px-6 py-6 text-center">
        <p className="text-zinc-500 text-sm">No items matched.</p>
      </div>
    );
  }
  return (
    <div className="mt-2 w-full">
      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <div className="flex gap-3 overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-hide pb-2">
        {items.map((item, i) => (
          <div key={`${item.id ?? item.name}-${i}`}
            className="w-[240px] shrink-0 snap-start"
            style={{ animationDelay: `${i * 40}ms`, animation: "fadeUp 0.3s ease both" }}>
            <ShowcaseCard item={item} orgId={orgId} onSaved={() => {}} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Chat message types (extend with optional showcaseItems) ───────────────────
interface ChatMsg {
  id: string;
  role: "manager" | "volooAI" | "system";
  message: string;
  actionExecuted?: string;
  timestamp: number;
  pending?: boolean;
  showcaseItems?: ShowcaseItem[];
}

interface Props { orgId: string; orgName?: string; }

export default function VolooChatUI({ orgId, orgName }: Props) {
  const [input, setInput] = useState("");
  // Local list of showcase payloads keyed by the message they accompany
  const [inlineShowcases, setInlineShowcases] = useState<Record<string, ShowcaseItem[]>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isLoading, error, showcasePayload, sendMessage, clearError, clearShowcase } =
    useVolooChat(orgId);

  // Directly attach the showcase to the ID returned from the database
  useEffect(() => {
    if (showcasePayload) {
      setInlineShowcases(prev => ({ ...prev, [showcasePayload.msgId]: showcasePayload.items }));
      clearShowcase();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showcasePayload]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isLoading]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage(orgId, text);
    inputRef.current?.focus();
  }, [input, isLoading, orgId, sendMessage]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full w-full bg-black">

      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-white/8 bg-[#09090b]">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-2xl bg-white/6 border border-white/10 flex items-center justify-center shrink-0">
            <svg className="h-4 w-4 text-zinc-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">VolooAI · Chat</p>
            {orgName && <p className="text-sm font-semibold text-white leading-none mt-0.5">{orgName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/4 px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-white/50 animate-pulse" />
          <span className="text-[10px] text-zinc-500 font-mono">Gemini 2.5 Flash</span>
        </div>
      </div>

      {/* ── Messages ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 min-h-0">

        {/* Empty state */}
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="h-16 w-16 rounded-3xl bg-white/4 border border-white/8 flex items-center justify-center">
              <svg className="h-7 w-7 text-zinc-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-white text-sm font-semibold">Chat with VolooAI</p>
              <p className="text-zinc-600 text-xs mt-1">Control your menu, storefront & more</p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="text-left rounded-2xl border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/14 px-4 py-2.5 text-[12px] text-zinc-400 hover:text-zinc-200 transition-all font-mono">
                  &ldquo;{s}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg: ChatMsg) => {
          const isManager = msg.role === "manager";
          const isSystem = msg.role === "system";
          const showcase = inlineShowcases[msg.id];

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="text-[10px] text-zinc-700 font-mono px-3 py-1 rounded-full border border-white/5 bg-white/2">
                  {msg.message}
                </span>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex flex-col ${isManager ? "items-end" : "items-start"}`}
              style={{ animation: "fadeUp 0.2s ease both" }}>

              {/* Tool badges (above AI message) */}
              {!isManager && msg.actionExecuted && (
                <div className="flex flex-wrap gap-1.5 mb-1 px-1">
                  {msg.actionExecuted.split(", ").map((t) => (
                    <span key={t} className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-0.5">
                      <span>{TOOL_ICON[t.trim()] ?? "🔧"}</span>
                      <span>{t.trim().replace(/_/g, " ")}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Bubble */}
              <div className={`max-w-[78%] lg:max-w-[65%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
                isManager
                  ? "bg-white text-black rounded-br-sm font-medium"
                  : "bg-white/6 border border-white/8 text-zinc-200 rounded-bl-sm"
              } ${msg.pending ? "opacity-50" : ""}`}>
                {msg.message}
              </div>

              {/* Inline showcase cards (AI messages only) */}
              {!isManager && showcase && (
                <div className="w-full mt-2">
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    <span className="text-[10px] text-zinc-600">📺</span>
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
                      RECOMMENDATIONS
                    </span>
                  </div>
                  <InlineShowcase items={showcase} orgId={orgId} />
                </div>
              )}

              {/* Timestamp */}
              <span className="text-[9px] text-zinc-700 px-1 mt-1">
                {new Date(msg.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          );
        })}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex items-start" style={{ animation: "fadeUp 0.2s ease both" }}>
            <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-white/6 border border-white/8 flex items-center gap-1.5">
              {[0, 0.15, 0.3].map((d, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce"
                  style={{ animationDelay: `${d}s`, animationDuration: "0.9s" }} />
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-xs text-rose-400">⚠ {error}</p>
            <button onClick={clearError} className="text-zinc-600 hover:text-zinc-300 text-xs shrink-0">✕</button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/8 px-4 py-3 bg-[#09090b] flex items-end gap-2.5"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
          onKeyDown={handleKey}
          placeholder="Type a command… (Enter to send)"
          rows={1}
          disabled={isLoading}
          className="flex-1 resize-none rounded-2xl border border-white/8 bg-white/4 px-4 py-2.5 text-[13px] text-zinc-200 placeholder-zinc-700 focus:border-white/20 focus:outline-none focus:bg-white/6 transition-all leading-relaxed disabled:opacity-40"
          style={{ overflow: "hidden" }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="shrink-0 h-10 w-10 rounded-2xl bg-white text-black flex items-center justify-center transition-all hover:bg-white/90 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
