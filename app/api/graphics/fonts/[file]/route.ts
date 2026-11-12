import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isFontFile } from "@/lib/graphics/fonts";

// GET /api/graphics/fonts/<file>.woff
// The faces the graphics are set in (assets/fonts, both OFL), for the
// Studio's in-browser preview (lib/graphics/fonts.ts previewFontFaces), so
// the preview sets type exactly like the server render. Only the listed
// files; public and cached for a year (the file names are fixed per face).

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!isFontFile(file)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  const data = await readFile(join(process.cwd(), "assets", "fonts", file));
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "font/woff", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
