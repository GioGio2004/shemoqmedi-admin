#!/usr/bin/env node
// Moves every listing preview video that is not on Cloudflare R2 yet (on
// ImageKit, or an old Convex storage file) to R2, compressed the same way
// as browser uploads (lib/videoUpload.ts): H.264 MP4, max 1280 px wide,
// <= 30 fps, ~2 Mbps cap, no audio, fast start. ImageKit originals are
// downloaded with tr=orig-true, which costs no video processing units.
// Each new file is swapped in on its listing (media:adoptFile) and the old
// copy is deleted (the ImageKit file too).
//
// Needs ffmpeg + ffprobe on PATH and R2_* in .env.local.
// Usage (from the shemoqmedi-admin folder):
//   node scripts/videos-to-r2.mjs            # dev deployment
//   node scripts/videos-to-r2.mjs --prod     # production deployment
//   node scripts/videos-to-r2.mjs --dry-run  # list what would move

import { execFileSync, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const dryRun = argv.includes("--dry-run");
const MAX_BYTES = 15 * 1024 * 1024; // LIMITS.videoBytes

function envFile(name) {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : undefined;
}
const R2 = Object.fromEntries(
  ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"].map((n) => {
    const value = process.env[n] ?? envFile(n);
    if (!value) throw new Error(`${n} missing (env or .env.local).`);
    return [n, value.replace(/\/+$/, "")];
  }),
);
const r2 = new AwsClient({
  accessKeyId: R2.R2_ACCESS_KEY_ID,
  secretAccessKey: R2.R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

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
const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "site";

function probe(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,avg_frame_rate:format=duration", "-of", "json", file],
    { encoding: "utf8" },
  );
  const j = JSON.parse(out);
  const s = j.streams?.[0] ?? {};
  const [num, den] = String(s.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    codec: s.codec_name,
    width: s.width,
    height: s.height,
    fps: den ? num / den : 0,
    duration: Number(j.format?.duration ?? 0),
  };
}

function compress(input, dir) {
  const src = probe(input);
  const out = join(dir, "out.mp4");
  const filters = ["scale='min(1280,trunc(iw/2)*2)':-2", ...(src.fps > 31 ? ["fps=30"] : [])];
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", input, "-an", "-vf", filters.join(","),
    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-maxrate", "2M", "-bufsize", "4M",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
  ]);
  // An already web-sized H.264 original can beat our settings: keep the smaller one.
  const keepOriginal =
    src.codec === "h264" && src.width <= 1280 && src.fps <= 31 && statSync(input).size <= statSync(out).size;
  return keepOriginal ? { path: input, src, ...src, note: "original kept" } : { path: out, src, ...probe(out) };
}

async function processOne(job, totals) {
  const dir = mkdtempSync(join(tmpdir(), "video-r2-"));
  try {
    const res = await fetch(job.url);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const input = join(dir, "in.mp4");
    writeFileSync(input, Buffer.from(await res.arrayBuffer()));
    const before = statSync(input).size;
    const out = compress(input, dir);
    const size = statSync(out.path).size;
    const line = `${job.slug}: ${mb(before)} ${out.src.width}x${out.src.height}@${out.src.fps.toFixed(0)} → ${mb(size)} ${out.width}x${out.height} (${out.duration.toFixed(1)} s)${out.note ? `, ${out.note}` : ""}`;
    if (size > MAX_BYTES) throw new Error(`${line}: still over 15 MB`);
    totals.before += before;
    totals.after += size;
    if (dryRun) return console.log(`· ${line}`);

    const slug = slugify(job.slug);
    const key = `listings/${slug}/${slug}-website-preview-${randomBytes(5).toString("hex")}.mp4`;
    const body = readFileSync(out.path);
    const objectUrl = `https://${R2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2.R2_BUCKET}/${key}`;
    const put = await r2.fetch(objectUrl, { method: "PUT", body, headers: { "Content-Type": "video/mp4" } });
    if (!put.ok) throw new Error(`R2 PUT HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
    const publicUrl = `${R2.R2_PUBLIC_URL}/${key}`;
    const check = await fetch(publicUrl, { method: "HEAD" });
    if (!check.ok || Number(check.headers.get("content-length")) !== size) {
      throw new Error(`public copy check failed (HTTP ${check.status})`);
    }
    convexRun("media:adoptFile", {
      listingId: job.listingId,
      from: job.from,
      file: {
        store: "r2",
        fileId: key,
        url: publicUrl,
        filePath: `/${key}`,
        kind: "video",
        contentType: "video/mp4",
        size,
        width: out.width,
        height: out.height,
      },
    });
    console.log(`✓ ${line}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(`Preview videos → R2 on the ${prod ? "PRODUCTION" : "dev"} deployment${dryRun ? " (dry run)" : ""}.`);
  const jobs = [
    // On ImageKit: the original upload, delivered as stored (no processing units).
    ...convexRun("media:largeVideos", { minBytes: 0 }).map((v) => {
      const url = new URL(v.url);
      url.searchParams.set("tr", "orig-true");
      return { listingId: v.listingId, slug: v.slug, from: v.mediaId, url: url.toString() };
    }),
    // Older Convex storage files.
    ...convexRun("media:legacyFilesInternal").flatMap((l) =>
      l.items
        .filter((i) => i.role === "video")
        .map((i) => ({ listingId: l.listingId, slug: l.slug, from: i.id, url: i.url })),
    ),
  ];
  console.log(`${jobs.length} video(s) to move.`);
  const totals = { before: 0, after: 0 };
  let failed = 0;
  for (const job of jobs) {
    try {
      await processOne(job, totals);
    } catch (err) {
      failed++;
      console.error(`✗ ${job.slug}: ${err.message}`);
    }
  }
  console.log(`Done. ${mb(totals.before)} → ${mb(totals.after)}${failed ? `, ${failed} failed (re-run to retry)` : ""}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
