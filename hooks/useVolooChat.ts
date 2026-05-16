// hooks/useVolooChat.ts
// ─────────────────────────────────────────────────────────────────────────────
// Text-chat hook for VolooAI — mirrors the capability of the voice agent but
// outputs typed messages instead of audio.
//
// Features:
//  • Loads persistent history from Convex (adminChats) via live query
//  • Sends messages to POST /api/voloo-ai/chat (Gemini 2.5 Flash + tools)
//  • Maintains local optimistic messages while the request is in flight
//  • Exposes showcase items returned by showcase_on_screen tool calls
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ShowcaseItem } from "./useGeminiLive";

export interface ChatMessage {
  id: string;
  role: "manager" | "volooAI" | "system";
  message: string;
  actionExecuted?: string;
  timestamp: number;
  /** Only present on optimistic (pending) messages */
  pending?: boolean;
}

export interface ShowcasePayload {
  msgId: string;
  items: ShowcaseItem[];
}

export interface UseVolooChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  showcasePayload: ShowcasePayload | null;
  sendMessage: (orgId: string, text: string) => Promise<void>;
  clearError: () => void;
  clearShowcase: () => void;
}

export function useVolooChat(orgId: string): UseVolooChatReturn {
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showcasePayload, setShowcasePayload] = useState<ShowcasePayload | null>(null);
  // Build a rolling "last N turns" for Gemini context
  const historyRef = useRef<Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>>([]);

  // Live Convex query — auto-updates when adminChats changes
  const persisted = useQuery(
    api.volooAi.getAdminChatHistory,
    orgId ? { orgId, limit: 60 } : "skip"
  );

  // Merge persisted + optimistic, deduplicate by id
  const persistedSet = new Set((persisted ?? []).map((m) => String(m.id)));
  const optimisticFiltered = optimistic.filter((m) => !persistedSet.has(m.id));

  const messages: ChatMessage[] = [
    ...(persisted ?? []).map((m) => ({
      id: String(m.id),
      role: m.role,
      message: m.message,
      actionExecuted: m.actionExecuted,
      timestamp: m.timestamp,
    })),
    ...optimisticFiltered,
  ];

  const sendMessage = useCallback(async (orgId: string, text: string) => {
    if (!text.trim() || isLoading) return;
    setError(null);

    // Optimistic user bubble
    const tempId = `opt-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempId,
      role: "manager",
      message: text.trim(),
      timestamp: Date.now(),
      pending: true,
    };
    setOptimistic((prev) => [...prev, userMsg]);
    setIsLoading(true);

    // Rolling history for Gemini context (last 10 turns)
    historyRef.current.push({ role: "user", parts: [{ text: text.trim() }] });
    if (historyRef.current.length > 20) historyRef.current = historyRef.current.slice(-20);

    try {
      const res = await fetch("/api/voloo-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          message: text.trim(),
          history: historyRef.current.slice(0, -1), // exclude the one we just pushed
        }),
      });

      const data = await res.json() as {
        success: boolean;
        reply?: string;
        toolsUsed?: string[];
        showcaseItems?: ShowcaseItem[] | null;
        msgId?: string;
        error?: string;
      };

      if (!data.success) throw new Error(data.error ?? "Unknown error");

      // Update history with model response
      historyRef.current.push({ role: "model", parts: [{ text: data.reply ?? "" }] });
      if (historyRef.current.length > 20) historyRef.current = historyRef.current.slice(-20);

      // Handle showcase items securely paired to the database row
      if (data.showcaseItems && data.showcaseItems.length > 0 && data.msgId) {
        setShowcasePayload({
          msgId: data.msgId,
          items: data.showcaseItems.map((item) => ({
            id: item.id ? String(item.id) : undefined,
            name: String(item.name ?? ""),
            price: Number(item.price ?? 0),
            isAvailable: Boolean(item.isAvailable ?? true),
            category: item.category ? String(item.category) : null,
            imageUrl: item.imageUrl ? String(item.imageUrl) : null,
            description: String(item.description ?? ""),
          }))
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      setError(msg);
    } finally {
      // Remove optimistic message — persisted version will arrive via Convex
      setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
      setIsLoading(false);
    }
  }, [isLoading]);

  return {
    messages,
    isLoading,
    error,
    showcasePayload,
    sendMessage,
    clearError: useCallback(() => setError(null), []),
    clearShowcase: useCallback(() => setShowcasePayload(null), []),
  };
}
