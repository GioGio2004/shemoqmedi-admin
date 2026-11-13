"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { NarrationView } from "@/convex/voiceover";
import { errorMessage } from "@/components/admin/format";
import { LIMITS, defaultMusic, recipeListingIds, type ReelRecipe } from "@/lib/reel/recipe";
import { WORDS_PER_SECOND, countWords, formatSec, scriptVoice, timelineOf, voiceFromNarration, wordBudget, type EditorAction } from "@/lib/studio/reelEditor";
import { ConfirmSheet, SheetError, Skel, Switch } from "../../ui";
import { useFlushOnLeave } from "./fields";
import { TrashIcon } from "../../icons";
import { MicIcon, UploadIcon } from "./icons";
import { Group, Seconds, Slider, pct } from "./fields";
import { uploadMusicFile } from "./upload";

// The reel's sound: the voice (write a script and voice it with ElevenLabs,
// or use an earlier narration), a music track (upload or pick; volume, loop,
// ducking under the voice) and the master volume of the clips' own sound.

type Voice = { name: string; voiceId: string; description?: string; previewUrl?: string };
let voicesCache: Promise<{ voices: Voice[] }> | null = null;

function useVoices() {
  const load = useAction(api.voiceover.voices);
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    voicesCache ??= load({});
    voicesCache.then(
      (out) => live && setVoices(out.voices),
      (err: unknown) => {
        voicesCache = null;
        if (live) setError(errorMessage(err));
      },
    );
    return () => {
      live = false;
    };
  }, [load]);
  return { voices, error };
}

function Earlier({ onPick, current }: { onPick: (n: NarrationView) => void; current?: string }) {
  const list = useQuery(api.voiceover.narrations, { limit: 30 });
  if (list === undefined) return <Skel style={{ height: 120, borderRadius: 18 }} />;
  if (!list.length) return <p className="st-note">No narrations yet.</p>;
  return (
    <ul className="st-re-picklist">
      {list.map((n) => (
        <li key={n.id}>
          <button type="button" className="st-re-pick" aria-pressed={n.id === current} onClick={() => onPick(n)}>
            <b>{n.script ? n.script.slice(0, 90) + (n.script.length > 90 ? "…" : "") : "Narration"}</b>
            <small className="st-tnum">
              {n.voice ?? "Voice"} · {formatSec(n.durationSec)}
              {n.words ? " · timed captions" : ""} · {new Date(n.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </small>
          </button>
        </li>
      ))}
    </ul>
  );
}

function VoiceGroup({ recipe, dispatch }: { recipe: ReelRecipe; dispatch: (a: EditorAction) => void }) {
  const ids = { script: useId(), voice: useId() };
  const voice = recipe.audio.voice;
  const { voices, error: voicesError } = useVoices();
  const generate = useAction(api.voiceover.generateTimed);
  const [script, setScript] = useState(voice?.script ?? "");
  const [narrator, setNarrator] = useState(voice?.voice ?? "");
  const [confirm, setConfirm] = useState(false);
  const [voicing, setVoicing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState(false);
  const reelSec = timelineOf(recipe).durationSec;
  const target = wordBudget(reelSec, voice?.startSec ?? 0);
  const words = countWords(script);
  const over = target > 0 && words > target;

  // The track's script changed elsewhere (undo, a reload, a narration picked): show it.
  const trackScript = voice?.script ?? "";
  const [seenScript, setSeenScript] = useState(trackScript);
  if (trackScript !== seenScript) {
    setSeenScript(trackScript);
    setScript(trackScript);
  }
  // The narrator: the one chosen here, else the track's, else the first (a renamed one falls back).
  const has = (name: string | undefined) => !!name && !!voices?.some((v) => v.name === name);
  const narratorName = has(narrator) ? narrator : has(voice?.voice) ? voice!.voice! : (voices?.[0]?.name ?? "");

  /** Keep the typed script on the voice track (it is saved with the reel, voiced or not). */
  function commitScript() {
    const s = script.trim();
    if (s === (voice?.script ?? "").trim()) return;
    if (!s && !voice?.url) dispatch({ type: "setVoice", voice: null });
    else if (s) dispatch({ type: "setVoice", voice: scriptVoice(s, narratorName, voice) });
  }
  useFlushOnLeave(commitScript);

  async function onGenerate() {
    setVoicing(true);
    setError(null);
    try {
      const listingId = recipeListingIds(recipe)[0] as Id<"listings"> | undefined;
      const n = await generate({ script: script.trim(), voice: narratorName, listingId });
      dispatch({ type: "setVoice", voice: voiceFromNarration(n, voice) });
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setVoicing(false);
    }
  }

  const chosen = voices?.find((v) => v.name === narratorName);
  const voiced = !!voice?.url && (voice.script ?? "").trim() === script.trim();

  return (
    <Group
      title="Voice"
      aside={
        voice ? (
          <button type="button" className="st-icon-btn is-plain" aria-label="Remove the voice" onClick={() => dispatch({ type: "setVoice", voice: null })}>
            <TrashIcon size={18} />
          </button>
        ) : undefined
      }
    >
      {voice?.url && (
        <div className="st-re-audio-row">
          <audio key={voice.url} src={voice.url} controls preload="metadata" className="st-re-audio" aria-label="The narration" />
          <p className="st-note st-tnum">
            {voice.voice ?? "Narration"} · {formatSec(voice.durationSec ?? 0)}
            {voice.durationSec && (voice.startSec ?? 0) + voice.durationSec > reelSec + 0.05 ? " · runs past the end and is cut" : ""}
          </p>
        </div>
      )}

      <div className="st-field">
        <label className="st-label" htmlFor={ids.voice}>
          <span>Narrator</span>
        </label>
        {voicesError ? (
          <p className="st-callout" data-tone="error" role="alert">
            {voicesError}
          </p>
        ) : voices === null ? (
          <Skel style={{ height: 48, borderRadius: 16 }} />
        ) : (
          <select id={ids.voice} className="st-input" value={narratorName} onChange={(e) => setNarrator(e.target.value)} disabled={voicing}>
            {voices.map((v) => (
              <option key={v.voiceId} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {chosen?.description && <p className="st-note">{chosen.description}</p>}
      </div>

      <div className="st-field">
        <label className="st-label" htmlFor={ids.script}>
          <span>Script</span>
          <span className="st-counter st-tnum" data-state={over ? "near" : undefined}>
            {words} words · {(words / WORDS_PER_SECOND).toFixed(1)} s{target ? ` · fits ${target}` : ""}
          </span>
        </label>
        <textarea
          id={ids.script}
          className="st-input"
          rows={5}
          maxLength={LIMITS.scriptChars}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          onBlur={commitScript}
          placeholder="Short and plain. Say what the sites are and who made them."
          disabled={voicing}
        />
        {target > 0 && (
          <>
            <div className="st-re-meter" data-state={over ? "over" : undefined} aria-hidden="true">
              <span style={{ "--fill": Math.min(1, words / target) } as React.CSSProperties} />
            </div>
            <p className="st-note st-tnum" aria-live="polite">
              {over ? `About ${words - target} words more than the reel holds (${WORDS_PER_SECOND} a second): the end is cut.` : `Room for about ${target - words} more words.`}
            </p>
          </>
        )}
      </div>

      <div className="st-sheet-foot">
        <button
          type="button"
          className={`st-btn st-btn-sm${voiced ? " st-btn-ghost" : ""}`}
          disabled={!script.trim() || !narratorName || voicing}
          data-busy={voicing}
          onClick={() => {
            commitScript();
            setConfirm(true);
          }}
        >
          <MicIcon size={18} />
          {voiced ? "Voice it again" : "Generate voice"}
        </button>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          {picking ? "Hide earlier ones" : "Use an earlier one"}
        </button>
      </div>
      <SheetError error={error} />
      {picking && (
        <Earlier
          current={voice?.narrationId}
          onPick={(n) => {
            setScript(n.script ?? "");
            if (n.voice) setNarrator(n.voice);
            dispatch({ type: "setVoice", voice: voiceFromNarration(n, voice) });
            setPicking(false);
          }}
        />
      )}

      {voice && (
        <>
          <Seconds label="Starts at" value={voice.startSec} min={0} max={Math.max(0, Math.floor(reelSec * 10) / 10)} step={0.5} onChange={(startSec) => dispatch({ type: "patchVoice", patch: { startSec } })} />
          <Slider label="Voice volume" value={voice.gain} min={0} max={LIMITS.gainMax} step={0.05} format={pct} onChange={(gain) => dispatch({ type: "patchVoice", patch: { gain } })} />
        </>
      )}

      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Voice this script?"
        confirmLabel="Generate"
        body={
          <>
            With <strong>{narratorName}</strong>, about <strong>{script.replace(/\s+/g, " ").trim().length}</strong> ElevenLabs credits. Captions are timed to the words.
          </>
        }
        onConfirm={onGenerate}
      />
    </Group>
  );
}

function MusicGroup({ recipe, dispatch }: { recipe: ReelRecipe; dispatch: (a: EditorAction) => void }) {
  const music = recipe.audio.music;
  const tracks = useQuery(api.reels.music, { limit: 30 });
  const getUrl = useAction(api.reels.uploadUrl);
  const register = useMutation(api.reels.registerUpload);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState(false);
  const hasVoice = !!recipe.audio.voice;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(0);
    try {
      const out = await uploadMusicFile(file, { uploadUrl: (a) => getUrl({ contentType: a.contentType, size: a.size }), register: (a) => register(a) }, setBusy);
      const base = music ?? defaultMusic(out.url);
      dispatch({ type: "setMusic", music: clean({ ...base, url: out.url, audioId: out.audioId ?? undefined, title: out.title, durationSec: out.durationSec, offsetSec: 0 }) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Group
      title="Music"
      aside={
        music ? (
          <button type="button" className="st-icon-btn is-plain" aria-label="Remove the music" onClick={() => dispatch({ type: "setMusic", music: null })}>
            <TrashIcon size={18} />
          </button>
        ) : undefined
      }
    >
      {music ? (
        <>
          <div className="st-re-audio-row">
            <audio key={music.url} src={music.url} controls preload="metadata" className="st-re-audio" aria-label={music.title ?? "Music"} />
            <p className="st-note st-tnum">
              {music.title ?? "Music"}
              {music.durationSec ? ` · ${formatSec(music.durationSec)}` : ""}
            </p>
          </div>
          <Seconds
            label="Start in the track"
            value={music.offsetSec}
            min={0}
            max={music.durationSec ? Math.max(0, Math.floor(music.durationSec - 1)) : 600}
            step={0.5}
            onChange={(offsetSec) => dispatch({ type: "patchMusic", patch: { offsetSec } })}
          />
          <Slider label="Music volume" value={music.gain} min={0} max={LIMITS.gainMax} step={0.05} format={pct} onChange={(gain) => dispatch({ type: "patchMusic", patch: { gain } })} />
          <Switch checked={music.loop} onChange={(loop) => dispatch({ type: "patchMusic", patch: { loop } })} label="Loop" hint="Start again when the track ends before the reel" />
          <Switch
            checked={music.duck.on}
            onChange={(on) => dispatch({ type: "patchMusic", patch: { duck: { ...music.duck, on } } })}
            label="Lower under the voice"
            hint={hasVoice ? "The music dips while the narrator speaks" : "Works once there is a voice"}
          />
          {music.duck.on && (
            <Slider
              label="How far down"
              value={music.duck.amount}
              min={0}
              max={1}
              step={0.05}
              format={pct}
              onChange={(amount) => dispatch({ type: "patchMusic", patch: { duck: { ...music.duck, amount } } })}
            />
          )}
        </>
      ) : (
        <p className="st-note">No music. Upload an MP3 or M4A (up to 20 MB), or use one uploaded before.</p>
      )}
      <div className="st-sheet-foot">
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => input.current?.click()} disabled={busy !== null} data-busy={busy !== null}>
          <UploadIcon size={18} />
          {music ? "Upload another" : "Upload music"}
        </button>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          {picking ? "Hide tracks" : "Pick a track"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a,.aac"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {busy !== null && (
        <div className="st-progress" role="progressbar" aria-label="Uploading the music" aria-valuenow={Math.round(busy * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${Math.round(busy * 100)}%` }} />
        </div>
      )}
      <SheetError error={error} />
      {picking &&
        (tracks === undefined ? (
          <Skel style={{ height: 100, borderRadius: 18 }} />
        ) : tracks.length === 0 ? (
          <p className="st-note">No tracks uploaded yet.</p>
        ) : (
          <ul className="st-re-picklist">
            {tracks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="st-re-pick"
                  aria-pressed={music?.url === t.url}
                  onClick={() => {
                    const base = music ?? defaultMusic(t.url);
                    dispatch({ type: "setMusic", music: clean({ ...base, url: t.url, audioId: t.id, title: t.title ?? undefined, durationSec: t.durationSec ?? undefined, offsetSec: 0 }) });
                    setPicking(false);
                  }}
                >
                  <b>{t.title ?? "Music"}</b>
                  <small className="st-tnum">
                    {t.durationSec ? formatSec(t.durationSec) : "Track"} · {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </Group>
  );
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export const AudioPanel = memo(function AudioPanel({ recipe, dispatch }: { recipe: ReelRecipe; dispatch: (a: EditorAction) => void }) {
  const videos = recipe.clips.filter((c) => c.source.kind === "listingVideo" || c.source.kind === "upload-video");
  const withSound = videos.filter((c) => c.audio.on).length;
  return (
    <div className="st-re-panel">
      <VoiceGroup recipe={recipe} dispatch={dispatch} />
      <MusicGroup recipe={recipe} dispatch={dispatch} />
      <Group title="Clips' own sound">
        <Slider
          label="All clips"
          value={recipe.audio.clipGain}
          min={0}
          max={LIMITS.gainMax}
          step={0.05}
          format={pct}
          onChange={(gain) => dispatch({ type: "setClipGain", gain })}
          hint={videos.length ? `${withSound} of ${videos.length} video ${videos.length === 1 ? "clip has" : "clips have"} its sound on. Switch each one in its clip settings.` : "No video clips yet."}
        />
      </Group>
      <Group title="Loudness">
        <Switch
          checked={recipe.audio.evenLoudness !== false}
          onChange={(on) => dispatch({ type: "setEvenLoudness", on })}
          label="Even out loudness"
          hint="Brings the whole reel to Instagram's level (−14 LUFS) without clipping. Off: the volumes play exactly as set."
        />
      </Group>
    </div>
  );
});
