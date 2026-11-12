"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showAlert, showError } from "@/components/admin/Alerts";
import { errorMessage } from "@/components/admin/format";
import { storefrontSiteUrl } from "@/lib/storefront";
import { buildReel, uploadReel } from "@/lib/voiceoverMux";
import { captionsForSave } from "@/lib/studio/captions";
import { draftCaptions } from "@/lib/studio/drafts";
import { createDraftStore } from "@/lib/studio/persist";
import { reelBuilds, type BuildStage, type ReelBuildState } from "@/lib/studio/reelBuild";
import { storyVideoProblem } from "@/convex/lib/socialApi";
import { useCanEncode } from "../hooks";
import { ConfirmSheet, PageHead, Skel } from "../ui";

// Reels: a listing's preview video with a spoken narration (ElevenLabs),
// built into an Instagram-safe MP4 in this browser (lib/voiceoverMux.ts,
// WebCodecs) and uploaded to R2. One tap turns it into a post. The build runs
// outside the page (lib/studio/reelBuild.ts) and the form is kept on this
// device, so leaving Reels mid-build loses nothing.

const WORDS_PER_SECOND = 2.5;

type Voice = { name: string; voiceId: string; description?: string; previewUrl?: string };
type Form = { listingId: string; voice: string; script: string; audioUrl: string };

const forms = createDraftStore<Form>("reels");
const IDLE: ReelBuildState = { stage: null, done: null };

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** 9:16 within a little tolerance (convex/lib/socialApi.ts storyProblem). */
function isVertical(w: number, h: number) {
  return Math.abs(w / h - 9 / 16) < 0.02;
}

export function Reels() {
  const router = useRouter();
  const canEncode = useCanEncode();
  const listings = useQuery(api.voiceover.listings, {});
  const loadVoices = useAction(api.voiceover.voices);
  const generate = useAction(api.voiceover.generate);
  const reelUploadUrl = useAction(api.voiceover.reelUploadUrl);
  const registerReel = useMutation(api.voiceover.registerReel);
  const createPost = useMutation(api.social.create);

  const ids = { listing: useId(), voice: useId(), script: useId(), audio: useId() };
  // The form as it was left on this device (the page mounts after the admin gate: client only).
  const [saved] = useState(() => forms.get("form"));
  const [listingId, setListingId] = useState(saved?.listingId ?? "");
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [voice, setVoice] = useState(saved?.voice ?? "");
  const [script, setScript] = useState(saved?.script ?? "");
  const [videoSec, setVideoSec] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState(saved?.audioUrl ?? "");
  const [voicing, setVoicing] = useState(false);
  const build = useSyncExternalStore(reelBuilds.subscribe, reelBuilds.get, () => IDLE);
  const [confirmVoice, setConfirmVoice] = useState(false);
  const [posting, setPosting] = useState<"feed" | "story" | null>(null);

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
  const stage: BuildStage | null = voicing ? { label: "Voicing the script…" } : build.stage;
  const busy = stage !== null;
  // The finished reel, while it still matches the listing and narration chosen here.
  const done = build.done && build.done.listingId === listingId && build.done.audioUrl === audioUrl ? build.done : null;
  const credits = script.replace(/\s+/g, " ").trim().length;

  // Kept on this device as it is typed, so coming back (or a reload) finds it.
  useEffect(() => {
    forms.set("form", { listingId, voice, script, audioUrl });
  }, [listingId, voice, script, audioUrl]);

  function pickListing(id: string) {
    setListingId(id);
    setVideoSec(null);
    setAudioUrl("");
  }

  async function onGenerate() {
    if (!listing) return;
    setVoicing(true);
    try {
      const out = await generate({ listingId: listing.id, script, voice });
      setAudioUrl(out.audioUrl);
      showAlert(`Narration ready (about ${out.durationSec} s).`, "success");
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setVoicing(false);
    }
  }

  async function onBuild() {
    if (!listing || !audioUrl || busy) return;
    const { id, videoUrl } = listing;
    try {
      // Runs outside this page: leaving Reels mid-build doesn't stop it, and the result is here on return.
      const built = await reelBuilds.run({ listingId: id, audioUrl }, async (report) => {
        const reel = await buildReel({ videoUrl, audioUrl }, (fraction) => report({ label: "Building the reel", fraction }));
        report({ label: `Uploading ${mb(reel.blob.size)}` });
        const { uploadUrl, key } = await reelUploadUrl({ listingId: id, size: reel.blob.size });
        await uploadReel(reel.blob, uploadUrl);
        const { url } = await registerReel({ key, size: reel.blob.size, width: reel.width, height: reel.height, durationSec: reel.durationSec });
        return { url, width: reel.width, height: reel.height, durationSec: reel.durationSec, heldSec: reel.heldSec, size: reel.blob.size };
      });
      if (built) showAlert("Reel uploaded.", "success");
    } catch (err) {
      showError(err);
    }
  }

  /** The finished reel as a waiting post (feed reel or story), opened in the queue. */
  async function post(placement: "feed" | "story") {
    if (!listing || !done) return;
    setPosting(placement);
    try {
      const drafts = draftCaptions("listing", { title: listing.title, studio: listing.creditName, pageUrl: storefrontSiteUrl(listing.slug) });
      const captions = placement === "story" ? { instagram: listing.title, facebook: listing.title } : drafts;
      const created = await createPost({
        kind: "custom",
        listingId: listing.id as Id<"listings">,
        captions: captionsForSave(captions),
        media: [{ kind: "video", url: done.url, role: "voiceover" }],
        placement,
      });
      reelBuilds.clear();
      router.push(`/queue?post=${created.id}`);
    } catch (err) {
      showError(err);
      setPosting(null);
    }
  }

  const vertical = done ? isVertical(done.width, done.height) : false;
  // Instagram and Facebook stories take 3 to 60 s of video (socialApi.storyVideoProblem).
  const lengthProblem = done ? storyVideoProblem(done.durationSec, "this reel") : null;
  const storyOk = vertical && !lengthProblem;

  return (
    <>
      <PageHead
        index="04"
        section="Reels"
        title="Reels."
        lede={`A listing's preview with a spoken narration. Write about ${WORDS_PER_SECOND} words a second: a longer narration holds the last frame, a shorter one ends in silence.`}
      />

      {canEncode === false && (
        <div className="st-callout" data-tone="ink" style={{ marginBottom: 16 }}>
          <span>
            This browser can&apos;t build video (no WebCodecs). You can voice the script here; build the reel in <strong style={{ color: "#fff" }}>desktop Chrome or Edge</strong>.
          </span>
        </div>
      )}

      {listings === undefined ? (
        <div className="st-split">
          <Skel style={{ height: 420, borderRadius: 14 }} />
          <Skel style={{ height: 420, borderRadius: 14 }} />
        </div>
      ) : listings.length === 0 ? (
        <div className="st-empty">
          <strong>No preview videos yet.</strong>A listing needs a preview video before it can become a reel.
        </div>
      ) : (
        <div className="st-split">
          <section className="st-panel" aria-label="Listing and narration">
            <div className="st-field">
              <label className="st-label" htmlFor={ids.listing}>
                <span>Listing</span>
              </label>
              <select id={ids.listing} className="st-input" value={listingId} onChange={(e) => pickListing(e.target.value)} disabled={busy}>
                <option value="">Choose a listing…</option>
                {listings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title} · {l.creditName}
                  </option>
                ))}
              </select>
            </div>

            {listing && (
              <video
                key={listing.videoUrl}
                src={listing.videoUrl}
                className="st-video"
                controls
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => setVideoSec(e.currentTarget.duration)}
              />
            )}

            <div className="st-field">
              <label className="st-label" htmlFor={ids.voice}>
                <span>Voice</span>
              </label>
              {voicesError ? (
                <p className="st-note">{voicesError}</p>
              ) : voices === null ? (
                <Skel style={{ height: 48 }} />
              ) : (
                <select id={ids.voice} className="st-input" value={voice} onChange={(e) => setVoice(e.target.value)} disabled={busy}>
                  {voices.map((v) => (
                    <option key={v.voiceId} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
              {chosenVoice?.description && <p className="st-note">{chosenVoice.description}</p>}
              {chosenVoice?.previewUrl && <audio key={chosenVoice.previewUrl} src={chosenVoice.previewUrl} controls preload="none" style={{ width: "100%" }} />}
            </div>

            <div className="st-field">
              <label className="st-label" htmlFor={ids.script}>
                <span>Narration</span>
                <span className="st-counter">
                  {scriptWords} words · {(scriptWords / WORDS_PER_SECOND).toFixed(1)} s{targetWords ? ` · aim ${targetWords}` : ""}
                </span>
              </label>
              <textarea
                id={ids.script}
                rows={6}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                className="st-input"
                placeholder="Short and plain. Say what the site is and who made it."
                disabled={busy}
              />
            </div>

            <button type="button" className="st-btn" onClick={() => setConfirmVoice(true)} disabled={!listing || !voice || !script.trim() || busy} data-busy={stage?.label === "Voicing the script…"}>
              Generate voice
            </button>
          </section>

          <section className="st-panel" aria-label="Reel">
            <div className="st-field">
              <label className="st-label" htmlFor={ids.audio}>
                <span>Narration (MP3 URL)</span>
              </label>
              <input
                id={ids.audio}
                value={audioUrl}
                onChange={(e) => setAudioUrl(e.target.value.trim())}
                className="st-input"
                inputMode="url"
                placeholder="Generate the voice, or paste an audioUrl"
                disabled={busy}
              />
              {audioUrl && <audio key={audioUrl} src={audioUrl} controls preload="metadata" style={{ width: "100%" }} />}
            </div>

            <button type="button" className="st-btn st-btn-blue" onClick={onBuild} disabled={!listing || !audioUrl || busy || canEncode === false}>
              Build the reel
            </button>
            {stage && (
              <div className="st-stack" style={{ gap: 6 }} role="status">
                <div className="st-progress" data-indeterminate={stage.fraction === undefined}>
                  <span style={stage.fraction !== undefined ? { width: `${Math.round(stage.fraction * 100)}%` } : undefined} />
                </div>
                <p className="st-note st-tnum">
                  {stage.label}
                  {stage.fraction !== undefined ? ` ${Math.round(stage.fraction * 100)}%` : "…"}
                </p>
              </div>
            )}

            {done ? (
              <div className="st-stack">
                <video src={done.url} className="st-video" controls playsInline />
                <p className="st-note st-tnum">
                  {done.durationSec.toFixed(1)} s · {mb(done.size)} · {done.width}×{done.height}
                  {done.heldSec > 0 ? ` · last frame held ${done.heldSec.toFixed(1)} s` : ""}
                </p>
                <div className="st-actions">
                  <button type="button" className="st-btn" onClick={() => post("feed")} disabled={posting !== null} data-busy={posting === "feed"}>
                    Post as reel
                  </button>
                  <button type="button" className="st-btn st-btn-ghost" onClick={() => post("story")} disabled={posting !== null || !storyOk} data-busy={posting === "story"}>
                    Post as story
                  </button>
                </div>
                {!vertical && <p className="st-note">Stories need a 9:16 video; this one is {done.width}×{done.height}, so it goes to the feed as a reel.</p>}
                {vertical && lengthProblem && <p className="st-note">{lengthProblem}</p>}
                <p className="st-note">It opens in the queue as a waiting post with draft captions, ready to edit and publish.</p>
              </div>
            ) : (
              !stage && <p className="st-note">The finished reel shows here.</p>
            )}
          </section>
        </div>
      )}

      <ConfirmSheet
        open={confirmVoice}
        onClose={() => setConfirmVoice(false)}
        title="Voice this script?"
        confirmLabel="Generate"
        body={
          <>
            With <strong>{voice}</strong>, about <strong>{credits}</strong> ElevenLabs credits.
          </>
        }
        onConfirm={onGenerate}
      />
    </>
  );
}
