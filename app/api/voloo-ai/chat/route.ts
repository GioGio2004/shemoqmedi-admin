// app/api/voloo-ai/chat/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// VolooAI Text Chat — POST /api/voloo-ai/chat
//
// Text-mode companion to the Live voice agent.
// Same 6 tools, same system instruction, same Convex mutations — but runs over
// standard HTTP (no WebSocket) using Gemini 2.5 Flash's function-calling mode.
//
// Request:  { orgId: string; message: string; history?: ChatTurn[] }
// Response: { success: true; reply: string; toolsUsed: string[] }
//           | { success: false; error: string }
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Tool } from "@google/generative-ai";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ── System instruction ────────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `SYSTEM DIRECTIVE: 
You are VolooAI, the intelligent merchant assistant and core administrative agent for Shemoqmesi.space and the Voloo ecosystem. 

OPERATIONAL ENVIRONMENT & ARCHITECTURE: 
You operate within the Voloo Admin Dashboard, but your intelligence relies on a real-time data bridge connected to the Shemoqmesi Storefront via Convex.
*   The Storefront (Data Source): Customer interactions, menu browsing times, and AI inquiries are tracked securely via Session Cookies.
*   The Admin Panel (Your Domain): You retrieve and analyze this cross-platform session data to give the store manager actionable insights about user behavior.

CORE DIRECTIVES & BOUNDARIES:
1. TOOL EXECUTION IS MANDATORY: You have access to function calls (tools) that interact directly with the database. You must NEVER hallucinate or guess prices, stock levels, menu items, or user behavior. You must ALWAYS use your tools to fetch live data or execute changes.
2. THE ANALYTICS BRIDGE MANDATE: When the manager asks about customer activity, you must use your tools to query the database for the relevant Session ID analytics. Furthermore, if the manager asks you about a specific product, or if you suggest a product, you MUST immediately call the 'query_menu' tool to fetch it, and then ALWAYS call 'showcase_on_screen' to display it visually. Do not just list them in text. This ensures your actions are logged back into the analytics stream.
3. VERIFIED ACTION CONFIRMATION: When commanded to update a price, change stock, or modify the menu, execute the required tool immediately. Do NOT confirm the action to the manager until the tool successfully returns a confirmation status. 
4. CONCISE COMMUNICATION: Managers require speed. Keep your responses brief, highly professional, and strictly focused on the task. Use bullet points or bold text to present data clearly.
5. PHYGITAL AWARENESS: You are integrated into a system that connects physical NFC hardware (crafted from premium walnut and leather) to this digital ecosystem. You must understand that a customer scanning a physical tag in the real world triggers the digital session data you are analyzing.

AVAILABLE TOOLS:
(1) toggle_menu_item — hide or show a menu item.
(2) query_menu — query the database; always call this FIRST before answering menu questions. If you are looking for a broad category like 'drinks', call without a searchTerm to get all items.
(3) showcase_on_screen — push items visually to the manager's screen; ALWAYS call after query_menu if the user wants to see items.
(4) update_description — rewrite the English description of a menu item.
(5) update_storefront_theme — change the restaurant's customer-facing storefront theme.
(6) broadcast_storefront_alert — push a real-time alert banner to ALL customers.`;

// ── Tool declarations using SchemaType enum ───────────────────────────────────
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "toggle_menu_item",
        description: "Hides or shows a specific item in the restaurant menu.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            action: { type: SchemaType.STRING, enum: ["hide", "show"] },
            targetName: { type: SchemaType.STRING },
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
          type: SchemaType.OBJECT,
          properties: {
            searchTerm: { type: SchemaType.STRING },
            isAvailable: { type: SchemaType.BOOLEAN },
          },
          required: [],
        },
      },
      {
        name: "showcase_on_screen",
        description: "Pushes rich menu item cards to the manager's dashboard screen.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            items: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  id: { type: SchemaType.STRING },
                  name: { type: SchemaType.STRING },
                  price: { type: SchemaType.NUMBER },
                  isAvailable: { type: SchemaType.BOOLEAN },
                  category: { type: SchemaType.STRING },
                  imageUrl: { type: SchemaType.STRING },
                  description: { type: SchemaType.STRING },
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
          type: SchemaType.OBJECT,
          properties: {
            targetId: { type: SchemaType.STRING },
            newText: { type: SchemaType.STRING },
          },
          required: ["targetId", "newText"],
        },
      },
      {
        name: "update_storefront_theme",
        description:
          "Changes the restaurant's digital storefront visual theme. Only provide the fields the manager wants to change.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            primaryColor: { type: SchemaType.STRING, description: "Primary brand color as hex (e.g. #4ade80)." },
            backgroundColor: { type: SchemaType.STRING, description: "Screen background color as hex." },
            textColor: { type: SchemaType.STRING, description: "Main text color." },
            fontFamily: { type: SchemaType.STRING, description: "Font: Inter, Roboto, Playfair Display, DM Sans, Space Grotesk." },
            buttonRadius: { type: SchemaType.STRING, description: "Corner radius: 9999px pill, 0.5rem rounded, 0px sharp." },
          },
          required: [],
        },
      },
      {
        name: "broadcast_storefront_alert",
        description:
          "Pushes a real-time alert banner to all customers. Pass empty string to clear.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            alertMessage: { type: SchemaType.STRING, description: "The message. Empty string clears the alert." },
          },
          required: ["alertMessage"],
        },
      },
    ],
  },
];


// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      orgId: string;
      message: string;
      history?: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
    };

    const { orgId, message, history = [] } = body;

    if (!orgId || !message?.trim()) {
      return NextResponse.json({ success: false, error: "Missing orgId or message" }, { status: 400 });
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ success: false, error: "AI service not configured." }, { status: 503 });
    }

    console.log(`💬 [VolooAI Chat] org="${orgId}" msg="${message.slice(0, 80)}"`);

    // ── Log manager message ─────────────────────────────────────────────────
    await convex.mutation(api.volooAi.logChat, {
      orgId,
      role: "manager",
      message: message.trim(),
    });

    // ── Build model with startChat for multi-turn ───────────────────────────
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: TOOLS as Tool[],
    });

    const chat = model.startChat({ history });

    const toolsUsed: string[] = [];
    let showcaseItems: unknown[] | null = null;
    let finalReply = "";

    // ── Round 1: send user message ──────────────────────────────────────────
    let result = await chat.sendMessage(message.trim());

    // ── Agentic loop: handle function calls ─────────────────────────────────
    for (let round = 0; round < 5; round++) {
      const response = result.response;
      const candidate = response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts ?? [];
      const textPart = parts.find((p) => p.text);
      if (textPart?.text) finalReply = textPart.text;

      const fnCalls = parts.filter((p) => p.functionCall);
      if (fnCalls.length === 0) break;

      // Execute tools and collect responses
      const fnResponseParts: Array<{ functionResponse: { name: string; response: Record<string, unknown> } }> = [];

      for (const part of fnCalls) {
        const fc = part.functionCall!;
        const args = fc.args as Record<string, unknown>;
        let responseData: Record<string, unknown> = {};

        toolsUsed.push(fc.name);
        console.log(`🔧 [VolooAI Chat] Tool: ${fc.name}`, args);

        if (fc.name === "toggle_menu_item") {
          try {
            const r = await convex.mutation(api.volooAi.toggleMenuItem, {
              orgId, targetName: String(args.targetName ?? ""), action: args.action as "hide" | "show",
            });
            responseData = { result: r.success ? "success" : "not_found", message: r.success ? `"${args.targetName}" is now ${args.action === "hide" ? "hidden" : "visible"}.` : `No item matching "${args.targetName}" found.` };
          } catch (e) { responseData = { result: "error", message: String(e) }; }
        }
        else if (fc.name === "query_menu") {
          try {
            const rows = await convex.query(api.volooAi.getMenuStatus, {
              orgId, searchTerm: args.searchTerm as string | undefined,
              isAvailable: args.isAvailable !== undefined ? Boolean(args.isAvailable) : undefined,
            });
            const items = rows.map((i) => ({ id: String(i.id), name: i.name, price: i.price, isAvailable: i.isAvailable, category: i.category, imageUrl: i.imageUrl, description: i.description }));
            responseData = { result: "success", message: `Found ${items.length} item(s). Data: ${JSON.stringify(items)}` };
          } catch (e) { responseData = { result: "error", message: String(e) }; }
        }
        else if (fc.name === "showcase_on_screen") {
          const raw = args.items as unknown[];
          showcaseItems = Array.isArray(raw) ? raw : [];
          responseData = { result: "success", message: `${showcaseItems.length} item(s) displayed.` };
        }
        else if (fc.name === "update_description") {
          try {
            const r = await convex.mutation(api.volooAi.updateItemDescription, {
              orgId, targetId: String(args.targetId ?? ""), newDescription: String(args.newText ?? ""),
            });
            responseData = { result: r.success ? "success" : "error", message: r.message };
          } catch (e) { responseData = { result: "error", message: String(e) }; }
        }
        else if (fc.name === "update_storefront_theme") {
          try {
            const r = await convex.mutation(api.volooAi.updateStorefrontTheme, {
              orgId,
              primaryColor: args.primaryColor as string | undefined,
              backgroundColor: args.backgroundColor as string | undefined,
              textColor: args.textColor as string | undefined,
              fontFamily: args.fontFamily as string | undefined,
              buttonRadius: args.buttonRadius as string | undefined,
            });
            responseData = { result: r.success ? "success" : "error", message: r.message };
          } catch (e) { responseData = { result: "error", message: String(e) }; }
        }
        else if (fc.name === "broadcast_storefront_alert") {
          try {
            const r = await convex.mutation(api.volooAi.broadcastStorefrontAlert, {
              orgId, alertMessage: String(args.alertMessage ?? ""),
            });
            responseData = { result: r.success ? "success" : "error", message: r.message };
          } catch (e) { responseData = { result: "error", message: String(e) }; }
        }
        else {
          responseData = { result: "error", message: `Unknown tool: ${fc.name}` };
        }

        fnResponseParts.push({ functionResponse: { name: fc.name, response: responseData } });
      }

      // Send function responses back to the model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await chat.sendMessage(fnResponseParts as any);
    }

    if (!finalReply) finalReply = "Done. Is there anything else I can help with?";

    const msgId = await convex.mutation(api.volooAi.logChat, {
      orgId, role: "volooAI", message: finalReply,
      actionExecuted: toolsUsed.length > 0 ? toolsUsed.join(", ") : undefined,
    });

    return NextResponse.json({ success: true, reply: finalReply, toolsUsed, showcaseItems, msgId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("❌ [VolooAI Chat] Unhandled:", err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
