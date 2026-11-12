import type { NextRequest } from "next/server";
import { FORMAT_IDS, isFormat } from "@/lib/graphics/spec";
import { previewAssets } from "@/lib/graphics/render";
import { PALETTE_CHOICES, authorized, bad, parseGlass } from "@/lib/graphics/server";

// GET /api/graphics/assets?shot=<url>&palette=egypt&glass=frost&format=ig_portrait
// What the Studio's instant preview (lib/graphics/preview.tsx) needs to draw
// a graphic in the browser exactly as the server will:
//
//   palette  { base, surface, accent }: the named palette, or the one "auto"
//            picks from the screenshot
//   light    glass: the backdrop is light (dark text, milkier panels)
//   back     glass backdrop for the format (a small JPEG data: URI; it is
//   frost    blurred, so the browser can stretch it)
//
// Not the screenshot itself: it is the same for every palette, so the
// browser loads it once by URL (lib/studio/create.ts previewShotUrl), and a
// palette strip doesn't download it once per palette.
//
// Built once per input and kept in memory (render.ts), and cached by the
// browser for ten minutes, so typing into the preview never asks again.
// Same access as /api/graphics: an admin session or x-render-key.

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return bad("Unauthorized", 401);
  const q = request.nextUrl.searchParams;
  const palette = q.get("palette") ?? "house";
  const format = q.get("format") ?? "ig_portrait";
  if (!PALETTE_CHOICES.includes(palette)) return bad(`Unknown palette. Use one of: ${PALETTE_CHOICES.join(", ")}`);
  if (!isFormat(format)) return bad(`Unknown format. Use one of: ${FORMAT_IDS.join(", ")}`);
  try {
    const assets = await previewAssets({ shot: q.get("shot"), palette, glass: parseGlass(q.get("glass")), format });
    return Response.json(assets, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (error) {
    console.error("graphics assets failed:", error instanceof Error ? error.stack : error);
    return bad("Failed to prepare the preview", 500);
  }
}
