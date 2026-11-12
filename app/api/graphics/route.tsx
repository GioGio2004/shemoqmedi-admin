import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { authedConvexClient } from "@/lib/convexServer";
import { STOREFRONT_URL } from "@/lib/storefront";
import { getPalette, isDark, PALETTE_IDS } from "@/lib/palettes";
import { FORMATS, FORMAT_IDS, TEMPLATES, TEMPLATE_IDS, isFormat, isTemplate } from "@/lib/graphics/spec";
import { renderTemplate, type Images } from "@/lib/graphics/templates";

// GET /api/graphics?template=award&format=ig_portrait&palette=house&title=…
// Renders one social post graphic as a PNG (satori via next/og).
//
//   template  award | new_listing | call_submissions | call_jury |
//             announcement | jury_quote | screenshot   (lib/graphics/spec.ts)
//   format    ig_portrait 1080×1350 | square 1080×1080 | story 1080×1920 |
//             link 1200×627
//   palette   lib/palettes.ts id (default house)
//   …fields   the template's text fields, by key (title, studio, headline, …)
//   …images   the template's image slots, by name (screenshot, badge): URLs
//             on our own hosts only (ImageKit, Convex, R2, the storefront)
//
// The award badge comes from the storefront (/badge/<awardSlug>) unless a
// `badge` URL is given. Images that can't be fetched render as an empty frame
// (or the tier mark), never as an error.
//
// Access: a signed-in platform admin (the Design page), or the header
// x-render-key = GRAPHICS_RENDER_KEY (convex/graphics.ts). proxy.ts lets this
// route through without a session so the key path works.

export const runtime = "nodejs";

const FONT_FILES = [
  ["latin", 400],
  ["latin", 500],
  ["latin", 600],
  ["latin", 700],
  ["latin-ext", 400],
  ["latin-ext", 500],
  ["latin-ext", 600],
  ["latin-ext", 700],
] as const;

let fontsPromise: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: "normal" }[]> | null =
  null;

function loadFonts() {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async ([subset, weight]) => ({
      name: "Inter",
      data: await readFile(join(process.cwd(), "assets", "fonts", `inter-${subset}-${weight}-normal.woff`)),
      weight,
      style: "normal" as const,
    })),
  ).catch((error) => {
    fontsPromise = null;
    throw error;
  });
  return fontsPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Access
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Images
// ─────────────────────────────────────────────────────────────────────────────

function hostOf(url: string | undefined) {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

/** Hosts images may come from: our own stores only, so the route can't be used to fetch anything else. */
function allowedHost(host: string) {
  const exact = new Set(
    [
      "ik.imagekit.io",
      "shemoqmedi.space",
      "www.shemoqmedi.space",
      hostOf(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT),
      hostOf(process.env.R2_PUBLIC_URL),
      hostOf(STOREFRONT_URL),
    ].filter(Boolean),
  );
  // Local storefront (badges) while developing.
  if (host === "localhost" && process.env.NODE_ENV !== "production") return true;
  return exact.has(host) || host.endsWith(".convex.cloud") || host.endsWith(".convex.site");
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/svg+xml"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Fetch one image as a data: URI satori can draw. ImageKit screenshots are
 * WebP, which satori can't read, so they're asked for as JPEG (at most
 * 1600 px wide). Anything else that isn't PNG/JPEG/GIF/SVG is dropped.
 */
async function loadImage(raw: string | null): Promise<string | null> {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
  if (!allowedHost(url.hostname)) return null;
  if (url.hostname === "ik.imagekit.io" || url.hostname === hostOf(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT)) {
    const tr = url.searchParams.get("tr");
    url.searchParams.set("tr", tr ? `${tr}:f-jpg` : "w-1600,f-jpg,q-88");
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!IMAGE_TYPES.has(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

function bad(message: string, status = 400) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const authorized = keyMatches(request.headers.get("x-render-key")) || (await isAdminSession());
  if (!authorized) return bad("Unauthorized", 401);

  const q = request.nextUrl.searchParams;
  const template = q.get("template");
  const format = q.get("format") ?? "ig_portrait";
  const paletteId = q.get("palette") ?? "house";
  if (!isTemplate(template)) return bad(`Unknown template. Use one of: ${TEMPLATE_IDS.join(", ")}`);
  if (!isFormat(format)) return bad(`Unknown format. Use one of: ${FORMAT_IDS.join(", ")}`);
  if (!(PALETTE_IDS as string[]).includes(paletteId)) return bad(`Unknown palette. Use one of: ${PALETTE_IDS.join(", ")}`);

  const spec = TEMPLATES[template];
  const palette = getPalette(paletteId);
  const fields: Record<string, string> = { ...spec.defaults };
  for (const key of [...spec.fields.map((f) => f.key), "kicker"]) {
    const value = q.get(key)?.trim();
    if (value) fields[key] = value.slice(0, 600);
  }

  // Image slots, fetched in parallel.
  const sources: Record<string, string | null> = {};
  for (const slot of spec.images) sources[slot] = q.get(slot);
  if (template === "award" && !sources.badge && fields.awardSlug && /^[a-z0-9-]{3,120}$/.test(fields.awardSlug)) {
    const theme = isDark(palette.base) ? "dark" : "light";
    sources.badge = `${STOREFRONT_URL}/badge/${fields.awardSlug}?shape=seal&theme=${theme}`;
  }
  const images: Images = Object.fromEntries(
    await Promise.all(Object.entries(sources).map(async ([slot, src]) => [slot, await loadImage(src)] as const)),
  );

  const { width, height } = FORMATS[format];
  try {
    return new ImageResponse(renderTemplate({ template, format, palette, fields, images }), {
      width,
      height,
      fonts: await loadFonts(),
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    console.error("graphics render failed:", error);
    return bad("Failed to render the graphic", 500);
  }
}
