// app/api/voloo-ai/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// VolooAI Brain — POST /api/voloo-ai
//
// Accepts: { orgId: string, message: string }
// Flow:
//   1. Send message to Gemini 2.5 Flash with a strict JSON system instruction.
//   2. Parse the JSON intent from the model.
//   3. If intent === "mutate_menu", execute the Convex toggleMenuItem mutation
//      via ConvexHttpClient (calls internal mutations, no Clerk JWT required).
//   4. Log both the chat turn and the action in Convex for audit trail.
//   5. Return the spoken_response + full aiLogic for the client to synthesize.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { api } from "@/convex/_generated/api";

// ── Type contract for Gemini's structured output ─────────────────────────────
interface VolooAIResponse {
  intent: "mutate_menu" | "chat";
  action: "hide" | "show" | "none";
  targetName: string | null;
  spoken_response: string;
}

// ── Convex HTTP client (server-side, no auth token needed for internal calls) -
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// ── Gemini client ─────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ─────────────────────────────────────────────────────────────────────────────
// System instruction — the personality and JSON contract for VolooAI
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `You are VolooAI, an intelligent AI coworker and business assistant embedded in the Shemoqmedi restaurant management dashboard. You speak any language including Georgian (ka-GE), English, and Russian.

Your ONLY output is STRICT JSON — never plain text, markdown, or explanations.

Output schema:
{ "intent": "mutate_menu" | "chat" | "greet", "action": "hide" | "show" | "none", "targetName": string | null, "spoken_response": string }

Rules:
- Message starts with [SYSTEM_GREET] → intent: "greet", action: "none", targetName: null. Greet the manager like a warm, professional coworker starting a shift. Use their name if given. Reference the time of day. Be encouraging and brief (2-3 sentences max). Match the language hint provided.
- Hide/disable/remove a menu item → intent: "mutate_menu", action: "hide"
- Show/enable/restore a menu item → intent: "mutate_menu", action: "show"
- Anything else → intent: "chat", action: "none", targetName: null
- spoken_response: spoken aloud to the manager, matches their input language, concise.

Examples:
Input: "[SYSTEM_GREET] name=Giorgi lang=ka time=morning"
Output: {"intent":"greet","action":"none","targetName":null,"spoken_response":"დილა მშვიდობისა, გიორგი! კიდევ ერთი დღე რესტორანში. მზად ვარ დაგეხმაროთ!"}

Input: "[SYSTEM_GREET] name=Manager lang=en time=evening"
Output: {"intent":"greet","action":"none","targetName":null,"spoken_response":"Good evening! Hope the day went well. I'm here and ready to help manage the restaurant."}

Input: "Hide the beef skewers"
Output: {"intent":"mutate_menu","action":"hide","targetName":"beef skewers","spoken_response":"Done. Beef skewers are now hidden from the menu."}

Input: "მაჩვენე ბეღელა"
Output: {"intent":"mutate_menu","action":"show","targetName":"ბეღელა","spoken_response":"გასაგებია. ბეღელა ისევ ხელმისაწვდომია მენიუში."}`;

// ─────────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // ── 1. Parse & validate request body ─────────────────────────────────────
    const body = await request.json();
    const { orgId, message } = body as { orgId: string; message: string };

    if (!orgId || typeof orgId !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid orgId" },
        { status: 400 },
      );
    }
    if (!message || typeof message !== "string" || message.trim() === "") {
      return NextResponse.json(
        { success: false, error: "Missing or empty message" },
        { status: 400 },
      );
    }

    // ── 2. Check required env vars ────────────────────────────────────────────
    if (!process.env.GEMINI_API_KEY) {
      console.error("❌ GEMINI_API_KEY is not set in environment variables.");
      return NextResponse.json(
        {
          success: false,
          error:
            "AI service is not configured. Add GEMINI_API_KEY to .env.local.",
        },
        { status: 503 },
      );
    }

    console.log(
      `🎙️ [VolooAI] Received command from org "${orgId}": "${message}"`,
    );

    // ── 3. Run Gemini 2.5 Flash with JSON output mode ─────────────────────────
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1, // Low temp for deterministic structured output
      },
    });

    const result = await model.generateContent(message.trim());
    const rawText = result.response.text();

    // ── 4. Parse the structured JSON response ────────────────────────────────
    let parsedJson: VolooAIResponse;
    try {
      // Strip markdown fences Gemini occasionally wraps around JSON
      const cleanText = rawText
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      parsedJson = JSON.parse(cleanText) as VolooAIResponse;
    } catch {
      console.error(
        "❌ [VolooAI] Failed to parse Gemini JSON output:",
        rawText,
      );
      return NextResponse.json(
        {
          success: false,
          error: "AI returned an unexpected format. Please try again.",
          rawText,
        },
        { status: 502 },
      );
    }

    console.log(
      `🤖 [VolooAI] Intent: ${parsedJson.intent}, Action: ${parsedJson.action}, Target: ${parsedJson.targetName}`,
    );

    // ── 5. Log the manager's voice command to adminChats ─────────────────────
    await convex.mutation(api.volooAi.logChat, {
      orgId,
      role: "manager",
      message: message.trim(),
    });

    // ── 6. Execute menu mutation if intent requires it ────────────────────────
    let mutationResult = null;

    if (
      parsedJson.intent === "mutate_menu" &&
      (parsedJson.action === "hide" || parsedJson.action === "show") &&
      parsedJson.targetName
    ) {
      mutationResult = await convex.mutation(api.volooAi.toggleMenuItem, {
        orgId,
        targetName: parsedJson.targetName,
        action: parsedJson.action,
      });

      // ── 7. Log the AI action in aiActionLogs ─────────────────────────────
      await convex.mutation(api.volooAi.logAction, {
        orgId,
        actionType: "MENU_MUTATION",
        targetId:
          mutationResult.matched > 0
            ? mutationResult.itemNames.join(", ")
            : undefined,
        details: `${parsedJson.action === "hide" ? "Hid" : "Showed"} "${parsedJson.targetName}" via manager voice command. Matched ${mutationResult.matched} item(s): ${mutationResult.itemNames.join(", ")}`,
      });

      // Adjust spoken response if no item was found
      if (!mutationResult.success) {
        parsedJson.spoken_response = `I couldn't find "${parsedJson.targetName}" in your menu. Please check the item name and try again.`;
      }
    }

    // ── 8. Log VolooAI's spoken response to adminChats ───────────────────────
    await convex.mutation(api.volooAi.logChat, {
      orgId,
      role: "volooAI",
      message: parsedJson.spoken_response,
      actionExecuted:
        parsedJson.intent === "mutate_menu" && mutationResult?.success
          ? `${parsedJson.action}_menu_item:${parsedJson.targetName}`
          : undefined,
    });

    // ── 9. Return success payload ─────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      aiLogic: parsedJson,
      mutationResult,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("❌ [VolooAI] Unhandled error in route:", error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
