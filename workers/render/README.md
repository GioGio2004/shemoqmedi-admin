# Render worker

Lays an ElevenLabs narration over a listing's muted preview video and uploads an Instagram-Reels-safe MP4 to R2. It's a single Node file plus ffmpeg, with no npm dependencies. It runs on the VPS next to Postiz.

`convex/voiceover.ts` (`voiceover.create`) calls it. Convex makes the narration MP3, puts it on R2, and then asks this worker to mux it. The worker never sees R2 credentials: it gets public URLs for the inputs and a presigned PUT URL for the output.

## API

Every `POST` needs the header `x-render-key: $RENDER_WORKER_KEY`.

| Route | Body | Returns |
| --- | --- | --- |
| `GET /health` | | `{ ok, queued }` |
| `POST /probe` | `{ url }` | `{ durationSec, width, height }` |
| `POST /mux` | `{ videoUrl, audioUrl, putUrl, layout? }` | `{ durationSec, size, width, height, videoSec, audioSec, heldSec }` |

`/mux`:

- **Length.** If the narration is longer than the video, the last frame is held (`tpad`) until the narration ends, plus 0.6 s. If it is shorter, the video keeps its length and the audio is padded with silence. Nothing ends up shorter than 3 s, which is Instagram's minimum.
- **Layout.** `"source"` (the default) keeps the preview's frame, capped at 1920 px. `"vertical"` centres it on a 1080×1920 black canvas.
- **Output.**
  - Video: H.264 High 4.1, yuv420p, 30 fps, 2 s closed GOP, CRF 20 capped at 8 Mb/s.
  - Audio: AAC-LC 128 kb/s, 48 kHz stereo, loudness-normalised to −14 LUFS.
  - Container: `+faststart`, so the moov atom comes before the media data.
- **Video handling.** The video is always re-encoded, even when no frame is held. That guarantees Instagram's codec, frame-rate and GOP rules whatever the browser produced.
- **Jobs.** One job runs at a time, with up to 4 waiting (`503` after that).
- **Errors.** Failures return `{ error }` with status 400 (bad input), 401 (key), 413 (too big), 422 (unreadable media), 502 (download/upload) or 500 (ffmpeg).

## Run on the VPS

1. Copy this folder next to Postiz's `docker-compose.yml`, for example as `render-worker/`.
2. Merge the `render` service from [`docker-compose.yml`](docker-compose.yml) into Postiz's compose file.
3. Add `RENDER_WORKER_KEY=<long random string>` to its `.env`. Generate one with `openssl rand -hex 32`.
4. Build and start it:

   ```bash
   docker compose up -d --build render
   ```

5. Point `render.shemoqmedi.space` at the VPS. Proxy it to `127.0.0.1:8080` in the same reverse proxy as Postiz, with HTTPS. A Caddy example:

   ```
   render.shemoqmedi.space {
     reverse_proxy 127.0.0.1:8080
   }
   ```

6. Check it:

   ```bash
   curl https://render.shemoqmedi.space/health
   ```

7. Set the Convex env on prod (and dev):

   ```bash
   npx convex env set RENDER_WORKER_URL https://render.shemoqmedi.space
   npx convex env set RENDER_WORKER_KEY <same key>
   ```

   Add `--prod` to set them on prod.

### Optional env

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | 8080 | Port the server listens on. |
| `FFMPEG_THREADS` | 2 | Threads x264 may use. |
| `JOB_TIMEOUT_SEC` | 300 | ffmpeg is killed after this long. |
| `MAX_DOWNLOAD_MB` | 200 | Largest input it will download. |
| `MAX_QUEUE` | 4 | Jobs allowed to wait. |
| `ALLOWED_HOSTS` | (any) | Comma list of hosts for `videoUrl`, `audioUrl` and `putUrl`. Set it to the R2 public domain and `<account>.r2.cloudflarestorage.com`, plus `ik.imagekit.io` while older previews still live on ImageKit. |

## Run locally

You need Node 22+ and ffmpeg/ffprobe on `PATH`.

```bash
RENDER_WORKER_KEY=dev-key-0123456789abcdef node server.mjs
```

```bash
npm test
```

`npm test` runs the argument and length rules, plus an end-to-end test. That test generates a muted 1280×720 clip and two sine-wave "narrations", serves them locally, runs the worker, and checks the uploaded reels with ffprobe (H.264, AAC 48 kHz stereo, moov before mdat, held vs padded length, vertical canvas). The end-to-end part is skipped when ffmpeg is missing.
