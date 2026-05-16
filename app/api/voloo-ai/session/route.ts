// app/api/voloo-ai/session/route.ts
// Secure endpoint that returns the Gemini API key server-side.
// The component fetches this before opening the WebSocket so the key
// never lives in client-side source code.

import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "YOUR_KEY_HERE") {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured in .env.local" },
      { status: 503 }
    );
  }
  return NextResponse.json({ apiKey });
}
