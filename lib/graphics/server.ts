import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { api } from "@/convex/_generated/api";
import { authedConvexClient } from "@/lib/convexServer";
import { getPalette, PALETTE_IDS, type Palette } from "@/lib/palettes";
import { autoPalette, buildBackdrop, finish, type Backdrop, type OutputType, type Picture } from "./imaging";
import type { GlassStyle } from "./glass";
import { FONT_FILES } from "./fonts";

// Shared by the graphics routes: fonts, access, satori → PNG → finished file.

type Font = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: "normal" | "italic" };
let fontsPromise: Promise<Font[]> | null = null;

export function loadFonts() {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async ({ family, file, weight, style }) => ({
      name: family,
      data: await readFile(join(process.cwd(), "assets", "fonts", file)),
      weight,
      style,
    })),
  ).catch((error) => {
    fontsPromise = null;
    throw error;
  });
  return fontsPromise;
}

function keyMatches(given: string | null) {
  const expected = process.env.GRAPHICS_RENDER_KEY;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function isAdminSession() {
  const session = await authedConvexClient().catch(() => null);
  if (!session) return false;
  try {
    const me = await session.client.query(api.users.getCurrentUser, {});
    return me?.role === "admin" || me?.role === "super_admin";
  } catch {
    return false;
  }
}

/**
 * The x-render-key header = GRAPHICS_RENDER_KEY (Convex), or a signed-in
 * platform admin (the Studio). A request that carries a key is judged by the
 * key alone: no Clerk and Convex round trip for server renders.
 */
export async function authorized(request: Request) {
  const key = request.headers.get("x-render-key");
  if (key !== null) return keyMatches(key);
  return isAdminSession();
}

export function bad(message: string, status = 400) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

/** Satori → PNG bytes. */
export async function renderPng(element: ReactElement, width: number, height: number) {
  const res = new ImageResponse(element, { width, height, fonts: await loadFonts() });
  return Buffer.from(await res.arrayBuffer());
}

export function imageResponse(bytes: Buffer, type: OutputType, filename?: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type === "jpeg" ? "image/jpeg" : "image/png",
      "Cache-Control": "private, max-age=60",
      ...(filename ? { "Content-Disposition": `inline; filename="${filename}"` } : {}),
    },
  });
}

export const GLASS_STYLES: GlassStyle[] = ["frost", "liquid", "tint"];
export const PALETTE_CHOICES = [...PALETTE_IDS, "auto"];

export function parseOutput(v: string | null): OutputType {
  return v === "png" ? "png" : "jpeg";
}

export function parseGlass(v: string | null): GlassStyle {
  return GLASS_STYLES.includes(v as GlassStyle) ? (v as GlassStyle) : "frost";
}

/** The palette for a render: a named one, or "auto" from the main picture. */
export async function resolvePalette(id: string, pic: Picture | null): Promise<Palette> {
  return id === "auto" ? autoPalette(pic, getPalette("night")) : getPalette(id);
}

/** Backdrop settings per glass treatment. */
export function backdropFor(
  style: GlassStyle,
  palette: Palette,
  width: number,
  height: number,
  layers: { pic: Picture; from: number; to: number }[],
): Promise<Backdrop> {
  const lightBase = luminanceOf(palette.base) > 0.5;
  const s = {
    frost: { veil: lightBase ? 0.58 : 0.5, blur: 26, frostBlur: 120, frostLight: lightBase ? 0.32 : 0.1 },
    liquid: { veil: lightBase ? 0.46 : 0.46, blur: 12, frostBlur: 64, frostLight: lightBase ? 0.22 : 0.05 },
    tint: { veil: lightBase ? 0.56 : 0.52, blur: 90, frostBlur: 140, frostLight: lightBase ? 0.2 : 0.03 },
  }[style];
  return buildBackdrop({ width, height, palette, layers, ...s });
}

function luminanceOf(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export { finish };
