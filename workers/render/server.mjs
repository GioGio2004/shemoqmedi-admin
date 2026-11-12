// Shemoqmedi render worker: lays an ElevenLabs narration over a listing's
// muted preview video and uploads an Instagram-Reels-safe MP4 to a presigned
// R2 PUT URL. Called by convex/voiceover.ts. No dependencies beyond Node and
// ffmpeg. See README.md.
//
//   GET  /health                                  → { ok: true }
//   POST /probe { url }                           → { durationSec, width, height }
//   POST /mux   { videoUrl, audioUrl, putUrl, layout? } → { durationSec, size, width, height, videoSec, audioSec, heldSec }
//
// Every POST needs the header x-render-key: $RENDER_WORKER_KEY.

import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isLayout, muxArgs, planMux, probe, run } from "./ffmpeg.mjs";

const KEY = process.env.RENDER_WORKER_KEY ?? "";
const PORT = Number(process.env.PORT ?? 8080);
const MAX_DOWNLOAD_BYTES = Number(process.env.MAX_DOWNLOAD_MB ?? 200) * 1024 * 1024;
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_SEC ?? 300) * 1000;
const THREADS = Number(process.env.FFMPEG_THREADS ?? 2);
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 4);
/** Optional comma list of hosts the worker may download from / upload to. */
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

if (KEY.length < 16) {
  console.error("RENDER_WORKER_KEY must be set (16+ characters).");
  process.exit(1);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const digest = (s) => createHash("sha256").update(s).digest();
const KEY_DIGEST = digest(KEY);

function authorised(req) {
  const given = req.headers["x-render-key"];
  return typeof given === "string" && timingSafeEqual(digest(given), KEY_DIGEST);
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new HttpError(413, "Request body too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Body must be JSON.");
  }
}

function checkUrl(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, `${field} must be a URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, `${field} must be http(s).`);
  if (ALLOWED_HOSTS.length && !ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new HttpError(400, `${field}: host ${url.hostname} is not in ALLOWED_HOSTS.`);
  }
  return url.toString();
}

/** Never log signed query strings. */
const safe = (url) => {
  const u = new URL(url);
  return `${u.host}${u.pathname}`;
};

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new HttpError(502, `Download ${safe(url)}: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new HttpError(413, `${safe(url)} is larger than MAX_DOWNLOAD_MB.`);
  let seen = 0;
  const limit = new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      cb(seen > MAX_DOWNLOAD_BYTES ? new HttpError(413, `${safe(url)} is larger than MAX_DOWNLOAD_MB.`) : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), limit, createWriteStream(dest));
}

async function upload(putUrl, file) {
  const body = await readFile(file);
  const res = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "content-length": String(body.length) },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new HttpError(502, `Upload to ${safe(putUrl)}: HTTP ${res.status}`);
  return body.length;
}

// One ffmpeg job at a time: the VPS also runs Postiz.
let chain = Promise.resolve();
let queued = 0;
function serial(job) {
  if (queued >= MAX_QUEUE) throw new HttpError(503, "The render queue is full. Try again in a minute.");
  queued++;
  const result = chain.then(job, job).finally(() => queued--);
  chain = result.catch(() => {});
  return result;
}

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "render-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function handleProbe(body) {
  const url = checkUrl(body.url, "url");
  return withTemp(async (dir) => {
    const file = join(dir, "input");
    await download(url, file);
    const info = await probe(file);
    if (!info.durationSec) throw new HttpError(422, "Could not read a duration from that file.");
    return { durationSec: round2(info.durationSec), width: info.width, height: info.height };
  });
}

async function handleMux(body) {
  const videoUrl = checkUrl(body.videoUrl, "videoUrl");
  const audioUrl = checkUrl(body.audioUrl, "audioUrl");
  const putUrl = checkUrl(body.putUrl, "putUrl");
  const layout = body.layout ?? "source";
  if (!isLayout(layout)) throw new HttpError(400, 'layout must be "source" or "vertical".');

  return serial(() =>
    withTemp(async (dir) => {
      const started = Date.now();
      const video = join(dir, "video");
      const audio = join(dir, "audio");
      const out = join(dir, "reel.mp4");
      await Promise.all([download(videoUrl, video), download(audioUrl, audio)]);
      const [v, a] = await Promise.all([probe(video), probe(audio)]);
      if (!v.hasVideo || !v.durationSec) throw new HttpError(422, "The video has no readable video stream.");
      if (!a.hasAudio || !a.durationSec) throw new HttpError(422, "The narration has no readable audio stream.");

      await run(
        "ffmpeg",
        muxArgs({ video, audio, out, videoSec: v.durationSec, audioSec: a.durationSec, layout, threads: THREADS }),
        JOB_TIMEOUT_MS,
      );
      const result = await probe(out);
      const size = await upload(putUrl, out);
      const { hold } = planMux(v.durationSec, a.durationSec);
      console.log(
        `mux ${safe(videoUrl)} video ${round2(v.durationSec)}s audio ${round2(a.durationSec)}s → ` +
          `${round2(result.durationSec)}s ${result.width}x${result.height} ${size} B in ${Date.now() - started} ms`,
      );
      return {
        durationSec: round2(result.durationSec),
        size,
        width: result.width,
        height: result.height,
        videoSec: round2(v.durationSec),
        audioSec: round2(a.durationSec),
        heldSec: hold,
      };
    }),
  );
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const routes = { "/probe": handleProbe, "/mux": handleMux };

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://worker").pathname;
  try {
    if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true, queued });
    const handler = routes[path];
    if (!handler) throw new HttpError(404, "Not found.");
    if (req.method !== "POST") throw new HttpError(405, "Use POST.");
    if (!authorised(req)) throw new HttpError(401, "Missing or wrong x-render-key.");
    send(res, 200, await handler(await readJson(req)));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`${req.method} ${path}: ${err?.message ?? err}`);
    send(res, status, { error: err?.message ?? String(err) });
  }
});

server.requestTimeout = 0; // a mux can take minutes; ffmpeg has its own timeout
server.listen(PORT, () => console.log(`render worker on :${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
