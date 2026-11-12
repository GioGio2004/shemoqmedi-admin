// End to end against real ffmpeg: generates a muted test video and two
// narrations, serves them from a local server that also accepts the PUT,
// runs the worker and checks what it uploads. Skipped when ffmpeg is missing.
//
//   npm test

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probe, run } from "../ffmpeg.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const KEY = "test-key-0123456789abcdef";
const WORKER_PORT = 18081;
const WORKER = `http://127.0.0.1:${WORKER_PORT}`;

let dir;
let files;
let files_server;
let base;
const uploads = new Map();
let worker;

before(async () => {
  if (!hasFfmpeg) return;
  dir = await mkdtemp(join(tmpdir(), "render-test-"));
  const f = (name) => join(dir, name);
  // 4 s muted 1280×720 H.264 (like a listing preview), 6 s and 2 s "narrations".
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", f("preview.mp4")], 60_000);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "6",
    "-c:a", "libmp3lame", "-b:a", "128k", f("long.mp3")], 60_000);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100", "-t", "2",
    "-c:a", "libmp3lame", "-b:a", "128k", f("short.mp3")], 60_000);
  files = { "/preview.mp4": f("preview.mp4"), "/long.mp3": f("long.mp3"), "/short.mp3": f("short.mp3") };

  files_server = createServer(async (req, res) => {
    if (req.method === "PUT") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      uploads.set(req.url, { body: Buffer.concat(chunks), type: req.headers["content-type"] });
      res.writeHead(200).end();
      return;
    }
    const file = files[req.url];
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": req.url.endsWith(".mp3") ? "audio/mpeg" : "video/mp4" });
    res.end(await readFile(file));
  });
  await new Promise((r) => files_server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${files_server.address().port}`;

  worker = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    env: { ...process.env, RENDER_WORKER_KEY: KEY, PORT: String(WORKER_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    worker.stdout.on("data", (d) => String(d).includes("render worker on") && resolve());
    worker.on("exit", (code) => reject(new Error(`worker exited ${code}`)));
  });
});

after(async () => {
  worker?.kill();
  files_server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const post = (path, body, key = KEY) =>
  fetch(`${WORKER}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-render-key": key },
    body: JSON.stringify(body),
  });

/** Top-level MP4 boxes in order. */
function boxes(buf) {
  const out = [];
  for (let at = 0; at + 8 <= buf.length; ) {
    const size = buf.readUInt32BE(at);
    out.push(buf.toString("latin1", at + 4, at + 8));
    if (size < 8) break;
    at += size;
  }
  return out;
}

async function checkReel(name) {
  const up = uploads.get(name);
  assert.ok(up, `nothing uploaded to ${name}`);
  assert.equal(up.type, "video/mp4");
  const order = boxes(up.body);
  assert.ok(order.indexOf("moov") < order.indexOf("mdat"), `moov must come first (faststart): ${order}`);
  const file = join(dir, name.slice(1));
  await writeFile(file, up.body);
  const out = await run("ffprobe", ["-v", "error", "-show_entries",
    "stream=codec_type,codec_name,profile,pix_fmt,sample_rate,channels,width,height", "-of", "json", file], 30_000);
  const streams = JSON.parse(out).streams;
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  assert.equal(v.codec_name, "h264");
  assert.equal(v.pix_fmt, "yuv420p");
  assert.equal(a.codec_name, "aac");
  assert.equal(a.sample_rate, "48000");
  assert.equal(a.channels, 2);
  return { ...(await probe(file)), v };
}

test("refuses a missing or wrong key", { skip: !hasFfmpeg }, async () => {
  assert.equal((await post("/mux", {}, "nope")).status, 401);
  assert.equal((await fetch(`${WORKER}/health`)).status, 200);
});

test("probe reads the preview's duration", { skip: !hasFfmpeg }, async () => {
  const res = await post("/probe", { url: `${base}/preview.mp4` });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Math.abs(body.durationSec - 4) < 0.1, JSON.stringify(body));
  assert.equal(body.width, 1280);
});

test("long narration: the last frame is held until it ends", { skip: !hasFfmpeg }, async () => {
  const res = await post("/mux", { videoUrl: `${base}/preview.mp4`, audioUrl: `${base}/long.mp3`, putUrl: `${base}/long-reel.mp4` });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const reel = await checkReel("/long-reel.mp4");
  assert.ok(Math.abs(reel.durationSec - 6.6) < 0.15, `duration ${reel.durationSec}`);
  assert.ok(Math.abs(body.durationSec - reel.durationSec) < 0.05);
  assert.equal(reel.v.width, 1280);
  assert.equal(body.size, uploads.get("/long-reel.mp4").body.length);
});

test("short narration: video length kept, silence after", { skip: !hasFfmpeg }, async () => {
  const res = await post("/mux", { videoUrl: `${base}/preview.mp4`, audioUrl: `${base}/short.mp3`, putUrl: `${base}/short-reel.mp4`, layout: "vertical" });
  assert.equal(res.status, 200, await res.clone().text());
  const reel = await checkReel("/short-reel.mp4");
  assert.ok(Math.abs(reel.durationSec - 4) < 0.15, `duration ${reel.durationSec}`);
  assert.equal(reel.v.width, 1080);
  assert.equal(reel.v.height, 1920);
});

test("bad input is a 400, a missing file a 502", { skip: !hasFfmpeg }, async () => {
  assert.equal((await post("/mux", { videoUrl: "file:///etc/passwd", audioUrl: `${base}/long.mp3`, putUrl: `${base}/x` })).status, 400);
  assert.equal((await post("/mux", { videoUrl: `${base}/preview.mp4`, audioUrl: `${base}/long.mp3`, putUrl: `${base}/x`, layout: "square" })).status, 400);
  assert.equal((await post("/mux", { videoUrl: `${base}/missing.mp4`, audioUrl: `${base}/long.mp3`, putUrl: `${base}/x` })).status, 502);
});
