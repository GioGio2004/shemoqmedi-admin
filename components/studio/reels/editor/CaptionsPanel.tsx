"use client";

import { memo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CAPTION_POSITIONS, CAPTION_STYLES, LIMITS, type ReelRecipe } from "@/lib/reel/recipe";
import { captionLinesFor, formatClock, type EditorAction } from "@/lib/studio/reelEditor";
import { ConfirmSheet, Switch } from "../../ui";
import { CAPTION_STYLE_LABEL, Choice, Group, POSITION_LABEL, useFlushOnLeave } from "./fields";

// Captions from the voice: on/off, style, position and every line's words
// (same number of words keeps the spoken timing; tap a line's time to play
// the preview from there). "Make again from the voice" starts over.

/** One line's text: typed freely, saved when the field is left (or Enter, or the panel goes away). */
function LineInput({ index, text, onCommit }: { index: number; text: string; onCommit: (text: string) => void }) {
  const [draft, setDraftState] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const setDraft = (d: string | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const commit = () => {
    const d = draftRef.current;
    if (d !== null && d.trim() && d.replace(/\s+/g, " ").trim() !== text) onCommit(d);
    setDraft(null);
  };
  useFlushOnLeave(commit);
  return (
    <input
      className="st-input"
      aria-label={`Caption line ${index + 1}`}
      value={draft ?? text}
      maxLength={LIMITS.captionLineChars}
      enterKeyHint="done"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape" && draft !== null) {
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

type Props = {
  recipe: ReelRecipe;
  dispatch: (a: EditorAction) => void;
  /** Seeks the preview there and plays it. */
  onPlayFrom: (t: number) => void;
  onOpenAudio: () => void;
};

export const CaptionsPanel = memo(function CaptionsPanel({ recipe, dispatch, onPlayFrom, onOpenAudio }: Props) {
  const voice = recipe.audio.voice;
  const [confirm, setConfirm] = useState(false);
  const narrations = useQuery(api.voiceover.narrations, voice?.narrationId ? { limit: 100 } : "skip");

  if (!voice) {
    return (
      <div className="st-re-panel">
        <p className="st-note">Captions come from the voice. Add a voice first; its words become the captions.</p>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={onOpenAudio}>
          Add a voice
        </button>
      </div>
    );
  }
  const cap = voice.captions;
  const remake = () => {
    const n = narrations?.find((x) => x.id === voice.narrationId);
    const lines = captionLinesFor({ words: n?.words ?? null, script: voice.script ?? n?.script ?? "", durationSec: voice.durationSec ?? n?.durationSec ?? 0 });
    dispatch({ type: "setCaptions", patch: { lines } });
  };

  return (
    <div className="st-re-panel">
      <Group title="Captions">
        <Switch checked={cap.on} onChange={(on) => dispatch({ type: "setCaptions", patch: { on } })} label="Show captions" hint="Word-timed subtitles from the voice" />
        <Choice label="Style" options={CAPTION_STYLES.map((s) => ({ value: s, label: CAPTION_STYLE_LABEL[s] }))} value={cap.style} onChange={(style) => dispatch({ type: "setCaptions", patch: { style } })} />
        <Choice label="Position" columns={3} options={CAPTION_POSITIONS.map((p) => ({ value: p, label: POSITION_LABEL[p] }))} value={cap.position} onChange={(position) => dispatch({ type: "setCaptions", patch: { position } })} />
      </Group>

      <Group
        title="Lines"
        aside={
          <button type="button" className="st-btn st-btn-quiet st-btn-sm" onClick={() => (cap.lines.length ? setConfirm(true) : remake())} disabled={!voice.url && !voice.script}>
            Make again
          </button>
        }
      >
        {!voice.url && <p className="st-note">The script isn&apos;t voiced yet. Generate the voice to time the captions to it.</p>}
        {cap.lines.length === 0 ? (
          <p className="st-note">No caption lines yet.</p>
        ) : (
          <ol className="st-re-lines">
            {cap.lines.map((l, i) => (
              <li key={i} className="st-re-line">
                <button type="button" className="st-re-line-time st-tnum" onClick={() => onPlayFrom(voice.startSec + l.startSec)} aria-label={`Play from line ${i + 1}, ${formatClock(voice.startSec + l.startSec)}`}>
                  {formatClock(voice.startSec + l.startSec)}
                </button>
                <LineInput index={i} text={l.text} onCommit={(text) => dispatch({ type: "editCaption", index: i, text })} />
                {!l.words && <span className="st-note st-re-line-note">Shows whole</span>}
              </li>
            ))}
          </ol>
        )}
        <p className="st-note">Keep the same number of words to keep the word-by-word timing.</p>
      </Group>

      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Make the captions again?"
        confirmLabel="Make again"
        body="Your edits to the lines are replaced with the voice's words."
        onConfirm={remake}
      />
    </div>
  );
});
