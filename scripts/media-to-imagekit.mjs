#!/usr/bin/env node
// Keeps every listing file on ImageKit and as small as possible.
//
//   1. Moves any screenshot still in Convex storage to ImageKit as WebP
//      (max 2560 px wide, q 86).
//   2. Deletes every Convex storage file no listing uses any more.
// Videos are skipped: they live on Cloudflare R2 now (every new video on
// ImageKit costs video processing units). Move them with "Move files" on the
// admin overview, which compresses each one in the browser.
// Files get SEO names in /listings/<slug>/, same as browser uploads.
//
// Needs ffmpeg + ffprobe on PATH and IMAGEKIT_PRIVATE_KEY in .env.local.
// Usage (from the shemoqmedi-admin folder):
//   node scripts/media-to-imagekit.mjs           # dev deployment (.env.local)
//   node scripts/media-to-imagekit.mjs --prod    # production deployment
//   node scripts/media-to-imagekit.mjs --dry-run # list what would change

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const dryRun = argv.includes("--dry-run");
const WEBP_MAX_SIDE = 16383; // libwebp limit

function envFile(name) {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : undefined;
}
const PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY ?? envFile("IMAGEKIT_PRIVATE_KEY");
if (!PRIVATE_KEY) throw new Error("IMAGEKIT_PRIVATE_KEY missing (env or .env.local).");

function convexRun(fn, payload = {}) {
  const json = JSON.stringify(payload);
  const quoted =
    process.platform === "win32" ? `"${json.replace(/"/g, '\\"')}"` : `'${json.replace(/'/g, "'\\''")}'`;
  const out = execSync(`npx convex run ${prod ? "--prod " : ""}${fn} ${quoted}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return out ? JSON.parse(out) : null;
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

function probe(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file],
    { encoding: "utf8" },
  );
  const s = JSON.parse(out).streams?.[0] ?? {};
  return { width: s.width, height: s.height };
}

/** Screenshot → WebP; falls back to the original when WebP would not work or not help. */
function optimizeImage(dir, input, type) {
  const { width, height } = probe(input);
  const scale = width > 2560 ? 2560 / width : 1;
  if (Math.round(height * scale) > WEBP_MAX_SIDE) return { path: input, type, width, height, note: "too tall for WebP, kept original" };
  const out = join(dir, "out.webp");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", "scale='min(2560,iw)':-1", "-c:v", "libwebp", "-quality", "86", "-compression_level", "6", out]);
  if (type === "image/webp" && statSync(out).size >= statSync(input).size) return { path: input, type, width, height, note: "already small WebP" };
  return { path: out, type: "image/webp", ...probe(out) };
}

async function upload(path, type, { slug, label }) {
  const ext = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4", "video/webm": "webm" }[type] ?? "bin";
  const fileName = `${slug}-website-${label}.${ext}`;
  const kind = type.startsWith("video/") ? "video" : "image";
  const form = new FormData();
  form.append("file", new Blob([readFileSync(path)], { type }), fileName);
  form.append("fileName", fileName);
  form.append("folder", `/listings/${slug}`);
  form.append("useUniqueFileName", "true");
  form.append("tags", `listing,${slug},${kind}`);
  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${PRIVATE_KEY}:`).toString("base64")}` },
    body: form,
  });
  if (!res.ok) throw new Error(`ImageKit upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const f = await res.json();
  return { fileId: f.fileId, url: f.url, filePath: f.filePath, kind, contentType: type, size: f.size, width: f.width, height: f.height };
}

async function download(url, dir) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
  const path = join(dir, "in");
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return { path, type };
}

async function processOne({ listingId, slug, from, url, label }, totals) {
  const dir = mkdtempSync(join(tmpdir(), "media-"));
  try {
    const src = await download(url, dir);
    const before = statSync(src.path).size;
    const opt = optimizeImage(dir, src.path, src.type);
    const after = statSync(opt.path).size;
    totals.before += before;
    totals.after += after;
    const line = `${slug} ${label}: ${src.type} ${mb(before)} → ${opt.type} ${mb(after)}${opt.note ? ` (${opt.note})` : ""}`;
    if (dryRun) return console.log(`[dry-run] ${line}`);
    const file = await upload(opt.path, opt.type, { slug, label });
    convexRun("media:adoptFile", { listingId, from, file });
    console.log(`✓ ${line}  ${file.url}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(`Media → ImageKit on the ${prod ? "PRODUCTION" : "dev"} deployment${dryRun ? " (dry run)" : ""}.`);
  const totals = { before: 0, after: 0 };
  let failed = 0;

  const legacy = convexRun("media:legacyFilesInternal");
  const jobs = legacy.flatMap((l) =>
    l.items.filter((item) => item.role !== "video").map((item) => ({
      listingId: l.listingId,
      slug: l.slug,
      from: item.id,
      url: item.url,
      label: item.role === "cover" ? "cover" : item.role === "video" ? "preview" : `screenshot-${item.position}`,
    })),
  );
  console.log(`${jobs.length} screenshot(s) still in Convex storage.`);

  for (const job of jobs) {
    try {
      await processOne(job, totals);
    } catch (err) {
      failed++;
      console.error(`✗ ${job.slug} ${job.label}: ${err.message}`);
    }
  }

  if (!dryRun) {
    const orphans = convexRun("media:deleteOrphanStorage");
    console.log(`Convex storage: deleted ${orphans.deleted} unused file(s); ${orphans.stillUsed} still in use.`);
  }
  console.log(`Done. ${mb(totals.before)} → ${mb(totals.after)}${failed ? `, ${failed} failed (re-run to retry)` : ""}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
