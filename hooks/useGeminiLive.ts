// hooks/useGeminiLive.ts
// ─────────────────────────────────────────────────────────────────────────────
// WebSocket hook for Gemini Live BidiGenerateContent API.
// NO "use client" — plain hook file used only by client components.
//
// AI tools:
//   toggle_menu_item       — hide/show a menu item
//   query_menu             — read DB, feed data back to AI
//   showcase_on_screen     — push rich cards to the UI
//   update_description     — live CMS edit of item description
//   update_storefront_theme — change primary color / dark mode on storefront
//
// Barge-in:
//   All AudioBufferSourceNode instances are tracked. When Gemini sends
//   serverContent.interrupted, every scheduled node is stopped immediately
//   and the play-time queue is reset, achieving true barge-in behavior.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

// ── Public types ──────────────────────────────────────────────────────────────
export type LiveStatus =
  | "disconnected"
  | "connecting"
  | "listening"
  | "speaking";

export interface ActionLogEntry {
  id: string;
  ts: string;
  tool: string;
  detail: string;
  success: boolean;
}

export interface ShowcaseItem {
  id?: string;
  name: string;
  price: number;
  isAvailable: boolean;
  category: string | null;
  imageUrl: string | null;
  description: string;
}

export interface ThemeUpdate {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  buttonRadius?: string;
}

export interface UseGeminiLiveReturn {
  status: LiveStatus;
  error: string | null;
  actionLog: ActionLogEntry[];
  connect: (orgId: string) => Promise<void>;
  disconnect: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";

const MODEL = "models/gemini-3.1-flash-live-preview";

const SYSTEM_INSTRUCTION =
  "You are VolooAI, an elite AI hospitality manager embedded in a premium restaurant dashboard. " +
  "Speak strictly in English. Be brief (1-2 sentences), confident, and professional. " +
  "You have access to six tools: " +
  "(1) toggle_menu_item — hide or show a menu item. " +
  "(2) query_menu — query the database; always call this FIRST before answering menu questions. " +
  "(3) showcase_on_screen — push items visually to the manager's screen; always call after query_menu. " +
  "(4) update_description — rewrite the English description of a menu item. " +
  "(5) update_storefront_theme — change the restaurant's customer-facing storefront theme: " +
  "primaryColor (hex), backgroundColor (hex), textColor (hex), fontFamily (e.g. Inter, Playfair Display), " +
  "or buttonRadius (e.g. 9999px for pill, 0.5rem for rounded). " +
  "(6) broadcast_storefront_alert — push a real-time alert banner to ALL customers currently viewing the menu. " +
  "Use this when the manager wants to announce anything: a delay, sold-out item, special offer, or any message. " +
  "Pass an empty string to clear and hide the alert. " +
  "You have total control over the restaurant's digital storefront appearance. " +
  "If the manager asks to change the vibe, mood, color scheme, font, or button style, call update_storefront_theme instantly. " +
  "If the manager asks to announce or broadcast something to customers, call broadcast_storefront_alert. " +
  "If the manager says to clear, remove, or hide the alert, call broadcast_storefront_alert with an empty string. " +
  "If the manager asks to read item details or a description, read it out loud smoothly. " +
  "If the manager asks to rewrite or change a description, call update_description. " +
  "CRITICAL: If the manager asks to see, show, or list menu items, you MUST immediately use the showcase_on_screen tool to display them visually after calling query_menu. Do not just list them in text. " +
  "Never make up menu data — always call query_menu first.";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// ── Gemini Live message shapes ────────────────────────────────────────────────
interface GeminiServerContent {
  serverContent: {
    modelTurn?: {
      parts: Array<{
        inlineData?: { mimeType: string; data: string };
        text?: string;
      }>;
    };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
}

interface GeminiToolCall {
  toolCall: {
    functionCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useGeminiLive({
  onShowcase,
  onThemeUpdate,
}: {
  onShowcase?: (items: ShowcaseItem[]) => void;
  onThemeUpdate?: (theme: ThemeUpdate) => void;
} = {}): UseGeminiLiveReturn {
  const [status, setStatus] = useState<LiveStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const orgIdRef = useRef<string>("");
  const isConnectingRef = useRef<boolean>(false);

  // ── Barge-in: track every scheduled AudioBufferSourceNode ────────────────
  // When interrupted fires, we call .stop() on all of them immediately.
  const activeSrcNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Callback refs — always fresh, no stale closures in WS handlers
  const onShowcaseRef = useRef<typeof onShowcase>(onShowcase);
  const onThemeUpdateRef = useRef<typeof onThemeUpdate>(onThemeUpdate);
  onShowcaseRef.current = onShowcase;
  onThemeUpdateRef.current = onThemeUpdate;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const log = (tag: string, ...args: unknown[]) =>
    console.log(
      `%c[VolooAI Live] ${tag}`,
      "color:#7dd3fc;font-weight:bold",
      ...args,
    );

  const fail = useCallback((msg: string, err?: unknown) => {
    console.error(`[VolooAI Live] ❌ ${msg}`, err ?? "");
    setError(msg);
    setStatus("disconnected");
    isConnectingRef.current = false;
  }, []);

  const addLog = useCallback(
    (tool: string, detail: string, success: boolean) => {
      const ts = new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setActionLog((prev) => [
        { id: `${Date.now()}-${Math.random()}`, ts, tool, detail, success },
        ...prev.slice(0, 29),
      ]);
    },
    [],
  );

  // ── Barge-in: stop all queued/playing audio nodes immediately ─────────────
  const stopAllAudio = useCallback(() => {
    activeSrcNodesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        /* already stopped — safe to ignore */
      }
    });
    activeSrcNodesRef.current.clear();
    nextPlayTimeRef.current = 0;
    log("⚡ Barge-in: all audio stopped");
  }, []);

  // ── Audio output: gapless 24 kHz PCM playback ─────────────────────────────
  const scheduleAudioChunk = useCallback((b64: string) => {
    if (!outCtxRef.current) {
      outCtxRef.current = new AudioContext({ sampleRate: 24000 });
      log("▶ Output AudioContext at 24 kHz");
    }
    const ctx = outCtxRef.current;

    try {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

      const buf = ctx.createBuffer(1, float32.length, 24000);
      buf.copyToChannel(float32, 0);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);

      // ── Barge-in tracking ──────────────────────────────────────────────
      activeSrcNodesRef.current.add(src);
      src.onended = () => activeSrcNodesRef.current.delete(src);

      const now = ctx.currentTime;
      const start = Math.max(nextPlayTimeRef.current, now + 0.05);
      src.start(start);
      nextPlayTimeRef.current = start + buf.duration;
    } catch (err) {
      console.error("[VolooAI Live] Audio decode error:", err);
    }
  }, []);

  // ── WS message handler ────────────────────────────────────────────────────
  const handleMessage = useCallback(
    async (raw: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        log("⚠ Non-JSON frame:", raw.slice(0, 120));
        return;
      }

      log(`📨 [${Object.keys(msg).join(",")}]`);

      // ── setupComplete ─────────────────────────────────────────────────────
      if ("setupComplete" in msg) {
        log("✅ Setup confirmed — LISTENING");
        setStatus("listening");
        setError(null);
        return;
      }

      // ── serverContent ─────────────────────────────────────────────────────
      if ("serverContent" in msg) {
        const sc = (msg as unknown as GeminiServerContent).serverContent;

        if (sc.interrupted) {
          // ── BARGE-IN: user spoke over the AI ───────────────────────────
          stopAllAudio();
          setStatus("listening");
          return;
        }

        let chunks = 0;
        if (sc.modelTurn?.parts) {
          for (const part of sc.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
              setStatus("speaking");
              scheduleAudioChunk(part.inlineData.data);
              chunks++;
            }
            if (part.text) log("📝 AI text:", part.text);
          }
        }
        if (chunks) log(`🔊 Queued ${chunks} chunk(s)`);

        if (sc.turnComplete) {
          const ctx = outCtxRef.current;
          const delayMs = ctx
            ? Math.max(
                300,
                (nextPlayTimeRef.current - ctx.currentTime) * 1000 + 400,
              )
            : 400;
          setTimeout(() => {
            nextPlayTimeRef.current = 0;
            setStatus("listening");
          }, delayMs);
        }
        return;
      }

      // ── toolCall ──────────────────────────────────────────────────────────
      if ("toolCall" in msg) {
        const { functionCalls } = (msg as unknown as GeminiToolCall).toolCall;
        log(`🔧 Tools: ${functionCalls.map((f) => f.name).join(", ")}`);

        const responses: Array<{
          id: string;
          response: Record<string, unknown>;
        }> = [];

        for (const fc of functionCalls) {
          log(`  → ${fc.name}(`, fc.args, `)`);

          // ── toggle_menu_item ────────────────────────────────────────────
          if (fc.name === "toggle_menu_item") {
            const action = fc.args.action as "hide" | "show";
            const targetName = String(fc.args.targetName ?? "");
            let success = false,
              message = "";
            try {
              const r = await convex.mutation(api.volooAi.toggleMenuItem, {
                orgId: orgIdRef.current,
                targetName,
                action,
              });
              success = r.success;
              message = success
                ? `"${targetName}" is now ${action === "hide" ? "hidden" : "visible"}.`
                : `No item matching "${targetName}" found.`;
            } catch (err) {
              console.error("[VolooAI] toggle_menu_item:", err);
              message = `DB error for "${targetName}".`;
            }
            addLog("toggle_menu_item", `${action}: ${targetName}`, success);
            responses.push({
              id: fc.id,
              response: { result: success ? "success" : "not_found", message },
            });
          }

          // ── query_menu ──────────────────────────────────────────────────
          else if (fc.name === "query_menu") {
            const searchTerm = fc.args.searchTerm as string | undefined;
            const isAvailable =
              fc.args.isAvailable !== undefined
                ? Boolean(fc.args.isAvailable)
                : undefined;
            let items: ShowcaseItem[] = [],
              message = "";
            try {
              const rows = await convex.query(api.volooAi.getMenuStatus, {
                orgId: orgIdRef.current,
                searchTerm,
                isAvailable,
              });
              items = rows.map((i) => ({
                id: String(i.id),
                name: i.name,
                price: i.price,
                isAvailable: i.isAvailable,
                category: i.category,
                imageUrl: i.imageUrl ?? null,
                description: i.description ?? "",
              }));
              message = `Found ${items.length} item(s). Data: ${JSON.stringify(items)}`;
              log(`  ✅ query_menu: ${items.length} result(s)`);
            } catch (err) {
              console.error("[VolooAI] query_menu:", err);
              message = "Database query failed.";
            }
            addLog(
              "query_menu",
              `isAvailable=${isAvailable ?? "any"} q="${searchTerm ?? ""}" → ${items.length}`,
              true,
            );
            responses.push({
              id: fc.id,
              response: { result: "success", message },
            });
          }

          // ── showcase_on_screen ──────────────────────────────────────────
          else if (fc.name === "showcase_on_screen") {
            const rawItems = fc.args.items as ShowcaseItem[] | undefined;
            const items: ShowcaseItem[] = Array.isArray(rawItems)
              ? rawItems.map((item) => ({
                  id: item.id ? String(item.id) : undefined,
                  name: String(item.name ?? ""),
                  price: Number(item.price ?? 0),
                  isAvailable: Boolean(item.isAvailable ?? true),
                  category: item.category ? String(item.category) : null,
                  imageUrl: item.imageUrl ? String(item.imageUrl) : null,
                  description: String(item.description ?? ""),
                }))
              : [];
            onShowcaseRef.current?.(items);
            log(`  ✅ showcase_on_screen: ${items.length} item(s) pushed`);
            addLog(
              "showcase_on_screen",
              `${items.length} item(s) displayed`,
              true,
            );
            responses.push({
              id: fc.id,
              response: {
                result: "success",
                message: `${items.length} item(s) displayed on manager screen.`,
              },
            });
          }

          // ── update_description ──────────────────────────────────────────
          else if (fc.name === "update_description") {
            const targetId = String(fc.args.targetId ?? "");
            const newText = String(fc.args.newText ?? "");
            let success = false,
              message = "";
            try {
              const r = await convex.mutation(
                api.volooAi.updateItemDescription,
                {
                  orgId: orgIdRef.current,
                  targetId,
                  newDescription: newText,
                },
              );
              success = r.success;
              message = r.message;
              log(`  ✅ update_description: saved for ${targetId}`);
            } catch (err) {
              console.error("[VolooAI] update_description:", err);
              message = "Failed to save description.";
            }
            addLog(
              "update_description",
              `${targetId.slice(-6)}: "${newText.slice(0, 40)}…"`,
              success,
            );
            responses.push({
              id: fc.id,
              response: { result: success ? "success" : "error", message },
            });
          }

          // ── update_storefront_theme ─────────────────────────────────────
          else if (fc.name === "update_storefront_theme") {
            const primaryColor = fc.args.primaryColor as string | undefined;
            const backgroundColor = fc.args.backgroundColor as
              | string
              | undefined;
            const textColor = fc.args.textColor as string | undefined;
            const fontFamily = fc.args.fontFamily as string | undefined;
            const buttonRadius = fc.args.buttonRadius as string | undefined;
            let success = false,
              message = "";
            let applied: ThemeUpdate = {};
            try {
              const r = await convex.mutation(
                api.volooAi.updateStorefrontTheme,
                {
                  orgId: orgIdRef.current,
                  primaryColor,
                  backgroundColor,
                  textColor,
                  fontFamily,
                  buttonRadius,
                },
              );
              success = r.success;
              message = r.message;
              if (r.success) applied = r.applied as ThemeUpdate;
              log(`  ✅ update_storefront_theme: applied`, applied);
            } catch (err) {
              console.error("[VolooAI] update_storefront_theme:", err);
              message = "Failed to update theme.";
            }
            if (success) onThemeUpdateRef.current?.(applied);
            const summary =
              Object.entries(applied)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => `${k}=${v}`)
                .join(" · ") || "no changes";
            addLog("update_storefront_theme", summary, success);
            responses.push({
              id: fc.id,
              response: { result: success ? "success" : "error", message },
            });
          }

          // ── broadcast_storefront_alert ───────────────────────────────────
          else if (fc.name === "broadcast_storefront_alert") {
            const alertMessage = String(fc.args.alertMessage ?? "");
            let success = false, message = "";
            try {
              const r = await convex.mutation(api.volooAi.broadcastStorefrontAlert, {
                orgId: orgIdRef.current,
                alertMessage,
              });
              success = r.success;
              message = r.message;
              log(`  ✅ broadcast_storefront_alert: "${alertMessage.slice(0, 60)}"`);
            } catch (err) {
              console.error("[VolooAI] broadcast_storefront_alert:", err);
              message = "Failed to broadcast alert.";
            }
            const detail = alertMessage.trim()
              ? `"${alertMessage.slice(0, 50)}"`
              : "Alert cleared";
            addLog("broadcast_storefront_alert", detail, success);
            responses.push({ id: fc.id, response: { result: success ? "success" : "error", message } });
          }

          // ── unknown tool ────────────────────────────────────────────────
          else {
            log(`  ⚠ Unknown tool: ${fc.name}`);
            responses.push({
              id: fc.id,
              response: {
                result: "error",
                message: `Unknown tool: ${fc.name}`,
              },
            });
          }
        }

        if (wsRef.current?.readyState === WebSocket.OPEN && responses.length) {
          wsRef.current.send(
            JSON.stringify({ toolResponse: { functionResponses: responses } }),
          );
          log("  ↩ toolResponse sent");
        }
        return;
      }

      // ── error frame ───────────────────────────────────────────────────────
      if ("error" in msg) {
        const e = msg.error as { message?: string; code?: number };
        fail(
          `Gemini API error ${e.code ?? ""}: ${e.message ?? JSON.stringify(e)}`,
        );
      }
    },
    [scheduleAudioChunk, stopAllAudio, addLog, fail],
  );

  // ── Mic capture ───────────────────────────────────────────────────────────
  const startMic = useCallback(async (ws: WebSocket) => {
    log("🎙 Requesting microphone…");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    const micCtx = new AudioContext({ sampleRate: 16000 });
    await micCtx.resume();
    micCtxRef.current = micCtx;
    log("🎙 Mic at", micCtx.sampleRate, "Hz");

    const source = micCtx.createMediaStreamSource(stream);
    const processor = micCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    let count = 0;
    processor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++)
        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32767));
      const bytes = new Uint8Array(i16.buffer);
      let bin = "";
      for (let i = 0; i < bytes.byteLength; i++)
        bin += String.fromCharCode(bytes[i]);
      ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: { data: btoa(bin), mimeType: "audio/pcm;rate=16000" },
          },
        }),
      );
      count++;
      if (count <= 3 || count % 100 === 0) log(`🎙 PCM chunk #${count}`);
    };
    source.connect(processor);
    processor.connect(micCtx.destination);
    log("🎙 Mic pipeline active");
  }, []);

  // ── connect ───────────────────────────────────────────────────────────────
  const connect = useCallback(
    async (orgId: string) => {
      if (isConnectingRef.current) return;
      isConnectingRef.current = true;
      setStatus("connecting");
      setError(null);
      orgIdRef.current = orgId;

      try {
        log("🔑 Fetching session key…");
        const res = await fetch("/api/voloo-ai/session");
        if (!res.ok) throw new Error(`Session endpoint: HTTP ${res.status}`);
        const json = (await res.json()) as { apiKey?: string; error?: string };
        if (!json.apiKey) throw new Error(json.error ?? "No API key");
        log("🔑 Key length:", json.apiKey.length);

        log("🌐 Opening WebSocket…");
        const ws = new WebSocket(`${WS_BASE}?key=${json.apiKey}`);
        wsRef.current = ws;

        ws.onopen = async () => {
          log("🌐 WS OPEN — sending setup");
          ws.send(
            JSON.stringify({
              setup: {
                model: MODEL,
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  thinkingConfig: { thinkingLevel: "minimal" },
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: "Aoede" },
                    },
                  },
                },
                systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
                tools: [
                  {
                    functionDeclarations: [
                      {
                        name: "toggle_menu_item",
                        description:
                          "Hides or shows a specific item in the restaurant menu.",
                        parameters: {
                          type: "OBJECT",
                          properties: {
                            action: { type: "STRING", enum: ["hide", "show"] },
                            targetName: { type: "STRING" },
                          },
                          required: ["action", "targetName"],
                        },
                      },
                      {
                        name: "query_menu",
                        description:
                          "Queries the restaurant database. Always call before answering menu questions. " +
                          "Returns items with id, name, price, isAvailable, category, imageUrl, description.",
                        parameters: {
                          type: "OBJECT",
                          properties: {
                            searchTerm: { type: "STRING" },
                            isAvailable: { type: "BOOLEAN" },
                          },
                          required: [],
                        },
                      },
                      {
                        name: "showcase_on_screen",
                        description:
                          "Pushes rich menu item cards to the manager's dashboard screen.",
                        parameters: {
                          type: "OBJECT",
                          properties: {
                            items: {
                              type: "ARRAY",
                              items: {
                                type: "OBJECT",
                                properties: {
                                  id: { type: "STRING" },
                                  name: { type: "STRING" },
                                  price: { type: "NUMBER" },
                                  isAvailable: { type: "BOOLEAN" },
                                  category: { type: "STRING" },
                                  imageUrl: { type: "STRING" },
                                  description: { type: "STRING" },
                                },
                              },
                            },
                          },
                          required: ["items"],
                        },
                      },
                      {
                        name: "update_description",
                        description:
                          "Updates the English description of a menu item. Requires the item id from a prior query_menu call.",
                        parameters: {
                          type: "OBJECT",
                          properties: {
                            targetId: { type: "STRING" },
                            newText: { type: "STRING" },
                          },
                          required: ["targetId", "newText"],
                        },
                      },
                      {
                        name: "update_storefront_theme",
                        description:
                          "Changes the restaurant's digital storefront visual theme. " +
                          "Changes the restaurant's customer-facing storefront theme. Only provide the fields the manager wants to change.",
                        parameters: {
                          type: "OBJECT",
                          properties: {
                            primaryColor: {
                              type: "STRING",
                              description:
                                "Primary brand / accent color as a hex code (e.g. #4ade80).",
                            },
                            backgroundColor: {
                              type: "STRING",
                              description:
                                "Screen background color as a hex code (e.g. #0f0f0f for dark, #faf7f2 for light).",
                            },
                            textColor: {
                              type: "STRING",
                              description: "Main text color (e.g. #f5f5f5).",
                            },
                            fontFamily: {
                              type: "STRING",
                              description:
                                "Font family name. Options: Inter, Roboto, Playfair Display, DM Sans, Space Grotesk.",
                            },
                            buttonRadius: {
                              type: "STRING",
                              description:
                                "Button corner radius. Use 9999px for pill, 0.5rem for rounded, 0px for sharp.",
                            },
                          },
                          required: [],
                        },
                      },
                      {
                        name: "broadcast_storefront_alert",
                        description:
                          "Pushes a real-time alert banner to all customers currently viewing the restaurant's digital menu. " +
                          "Use this to announce delays, sold-out items, special offers, or any urgent message. " +
                          "Pass an empty string as alertMessage to clear and hide an existing alert.",
                        parameters: {
                          type: "OBJECT",
                          properties: {
                            alertMessage: {
                              type: "STRING",
                              description:
                                "The message to display to customers. Pass an empty string to clear the alert.",
                            },
                          },
                          required: ["alertMessage"],
                        },
                      },
                    ],
                  },
                ],
              },
            }),
          );
          log("📤 Setup sent — awaiting setupComplete…");
          try {
            await startMic(ws);
          } catch (err) {
            fail("Mic access denied.", err);
            ws.close();
          }
        };

        ws.onmessage = async (event: MessageEvent) => {
          const text =
            typeof event.data === "string"
              ? event.data
              : await (event.data as Blob).text();
          await handleMessage(text);
        };

        ws.onerror = (e) => {
          console.error("[VolooAI Live] WS error:", e);
          fail("WebSocket error. Check API key and network.");
        };

        ws.onclose = (e) => {
          log(`🌐 WS CLOSED code=${e.code} reason="${e.reason}"`);
          isConnectingRef.current = false;
          if (e.code !== 1000 && e.code !== 1005) {
            setError(
              e.reason ||
                (e.code === 1006
                  ? "Connection dropped (1006). Verify API key."
                  : `Closed: code ${e.code}`),
            );
          }
          setStatus("disconnected");
        };
      } catch (err) {
        fail(err instanceof Error ? err.message : "Unknown error", err);
      }
    },
    [startMic, handleMessage, fail],
  );

  // ── disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    log("🔌 Disconnecting…");
    stopAllAudio();
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micCtxRef.current?.close().catch(() => {});
    micCtxRef.current = null;
    outCtxRef.current?.close().catch(() => {});
    outCtxRef.current = null;
    wsRef.current?.close(1000, "User disconnected");
    wsRef.current = null;
    isConnectingRef.current = false;
    setStatus("disconnected");
    setError(null);
    log("🔌 Done");
  }, [stopAllAudio]);

  return { status, error, actionLog, connect, disconnect };
}
