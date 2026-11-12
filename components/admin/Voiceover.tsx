"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { buildReel, uploadReel } from "@/lib/voiceoverMux";
import { CopyUrl } from "./ClaimLink";
import { Select } from "./Select";
import { showAlert, showError } from "./Alerts";
import { errorMessage } from "./format";

const WORDS_PER_SECOND = 2.5;

type Voice = { name: string; voiceId: string; description?: string; previewUrl?: string };
type Stage = { label: string; fraction?: number } | null;
type Done = { url: string; durationSec: number; heldSec: number; size: number };

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Voiceover reels: pick a listing, write (or paste) a narration, voice it
 * with ElevenLabs, then build the reel in this browser (lib/voiceoverMux.ts)
 * and upload it to R2. The URL goes on a social post.
 */
export function Voiceover() {
  const listings = useQuery(api.voiceover.listings, {});
  const loadVoices = useAction(api.voiceover.voices);
  const generate = useAction(api.voiceover.generate);
  const reelUploadUrl = useAction(api.voiceover.reelUploadUrl);
  const registerReel = useMutation(api.voiceover.registerReel);

  const ids = { listing: useId(), voice: useId(), script: useId(), audio: useId() };
  const [listingId, setListingId] = useState("");
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [voice, setVoice] = useState("");
  const [script, setScript] = useState("");
  const [videoSec, setVideoSec] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [stage, setStage] = useState<Stage>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    let live = true;
    loadVoices({})
      .then((out) => {
        if (!live) return;
        setVoices(out.voices);
        setVoice((current) => current || out.voices[0]?.name || "");
      })
      .catch((err: unknown) => live && setVoicesError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [loadVoices]);

  const listing = useMemo(() => listings?.find((l) => l.id === listingId), [listings, listingId]);
  const chosenVoice = voices?.find((v) => v.name === voice);
  const scriptWords = words(script);
  const targetWords = videoSec ? Math.max(1, Math.round(videoSec * WORDS_PER_SECOND)) : null;
  const busy = stage !== null;

  function pickListing(id: string) {
    setListingId(id);
    setVideoSec(null);
    setAudioUrl("");
    setDone(null);
  }

  async function onGenerate() {
    if (!listing || busy) return;
    const chars = script.replace(/\s+/g, " ").trim().length;
    if (!confirm(`Voice this script with ${voice}? It uses about ${chars} ElevenLabs credits.`)) return;
    setStage({ label: "Voicing the script…" });
    try {
      const out = await generate({ listingId: listing.id, script, voice });
      setAudioUrl(out.audioUrl);
      setDone(null);
      showAlert(`Narration ready (about ${out.durationSec} s).`, "success");
    } catch (err) {
      showError(err);
    } finally {
      setStage(null);
    }
  }

  async function onBuild() {
    if (!listing || !audioUrl || busy) return;
    setDone(null);
    try {
      setStage({ label: "Building the reel…", fraction: 0 });
      const reel = await buildReel({ videoUrl: listing.videoUrl, audioUrl }, (fraction) =>
        setStage({ label: "Building the reel…", fraction }),
      );
      setStage({ label: `Uploading ${mb(reel.blob.size)}…` });
      const { uploadUrl, key } = await reelUploadUrl({ listingId: listing.id, size: reel.blob.size });
      await uploadReel(reel.blob, uploadUrl);
      const { url } = await registerReel({ key, size: reel.blob.size, width: reel.width, height: reel.height, durationSec: reel.durationSec });
      setDone({ url, durationSec: reel.durationSec, heldSec: reel.heldSec, size: reel.blob.size });
      showAlert("Reel uploaded.", "success");
    } catch (err) {
      showError(err);
    } finally {
      setStage(null);
    }
  }

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Social</p>
          <h1>Voiceover.</h1>
          <p>
            A listing&apos;s preview with a spoken narration, for Instagram Reels. Write about{" "}
            {WORDS_PER_SECOND} words a second. A longer narration holds the last frame; a shorter one ends in silence.
            The reel is built in this browser and uploaded to R2.
          </p>
        </div>
      </div>

      {listings === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : listings.length === 0 ? (
        <p className="admin-empty">No listing has a preview video yet.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="admin-panel grid content-start gap-5" aria-label="Listing and narration">
            <div className="grid gap-2">
              <span id={ids.listing} className="admin-eyebrow">
                Listing
              </span>
              <Select
                labelledBy={ids.listing}
                value={listingId}
                onChange={pickListing}
                placeholder="Choose a listing…"
                options={listings.map((l) => ({ value: l.id, label: `${l.title} · ${l.creditName}` }))}
                disabled={busy}
              />
            </div>

            {listing && (
              <video
                key={listing.videoUrl}
                src={listing.videoUrl}
                className="w-full rounded-2xl border border-black/10 bg-black"
                controls
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => setVideoSec(e.currentTarget.duration)}
              />
            )}

            <div className="grid gap-2">
              <span id={ids.voice} className="admin-eyebrow">
                Voice
              </span>
              {voicesError ? (
                <p className="text-sm text-black/70">{voicesError}</p>
              ) : voices === null ? (
                <p className="text-sm text-black/55">Loading voices…</p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    labelledBy={ids.voice}
                    value={voice}
                    onChange={setVoice}
                    options={voices.map((v) => ({ value: v.name, label: v.name }))}
                    disabled={busy}
                    className="min-w-48"
                  />
                  {chosenVoice?.previewUrl && (
                    <audio key={chosenVoice.previewUrl} src={chosenVoice.previewUrl} controls preload="none" />
                  )}
                </div>
              )}
              {chosenVoice?.description && <p className="text-xs text-black/55">{chosenVoice.description}</p>}
            </div>

            <div className="grid gap-2">
              <label htmlFor={ids.script} className="admin-eyebrow">
                Narration script
              </label>
              <textarea
                id={ids.script}
                rows={6}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                className="admin-input resize-y"
                placeholder="Short, plain, no hype. Say what the site is and who made it."
                aria-describedby={`${ids.script}-count`}
                disabled={busy}
              />
              <p id={`${ids.script}-count`} className="text-xs text-black/55">
                {scriptWords} words · about {(scriptWords / WORDS_PER_SECOND).toFixed(1)} s spoken
                {videoSec && targetWords ? ` · the preview is ${videoSec.toFixed(1)} s, about ${targetWords} words` : ""}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="admin-button"
                onClick={onGenerate}
                disabled={!listing || !voice || !script.trim() || busy}
              >
                Generate voice
              </button>
            </div>
          </section>

          <section className="admin-panel grid content-start gap-5" aria-label="Reel">
            <div className="grid gap-2">
              <label htmlFor={ids.audio} className="admin-eyebrow">
                Narration (MP3 URL)
              </label>
              <input
                id={ids.audio}
                value={audioUrl}
                onChange={(e) => {
                  setAudioUrl(e.target.value.trim());
                  setDone(null);
                }}
                className="admin-input admin-mono"
                style={{ textTransform: "none" }}
                placeholder="Generate the voice, or paste the audioUrl from create_voiceover"
                disabled={busy}
              />
              {audioUrl && <audio key={audioUrl} src={audioUrl} controls preload="metadata" className="w-full" />}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="admin-button" onClick={onBuild} disabled={!listing || !audioUrl || busy}>
                Build video
              </button>
              {stage && (
                <p className="text-sm text-black/70" role="status">
                  {stage.label}
                  {stage.fraction !== undefined ? ` ${Math.round(stage.fraction * 100)}%` : ""}
                </p>
              )}
            </div>

            {done ? (
              <div className="grid gap-3">
                <video src={done.url} className="w-full rounded-2xl border border-black/10 bg-black" controls playsInline />
                <p className="text-xs text-black/55">
                  {done.durationSec.toFixed(1)} s · {mb(done.size)} · H.264 + AAC
                  {done.heldSec > 0 ? ` · last frame held ${done.heldSec.toFixed(1)} s` : ""}
                </p>
                <CopyUrl url={done.url} label="Copy URL" />
              </div>
            ) : (
              <p className="text-sm text-black/55">
                The finished reel shows here, with its URL for the social post.
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
