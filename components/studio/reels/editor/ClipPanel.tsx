"use client";

import { memo, useId } from "react";
import {
  FITS,
  LIMITS,
  MOTIONS,
  TEXT_POSITIONS,
  TEXT_SIZES,
  TEXT_STYLES,
  TRANSITIONS,
  isVideoClip,
  type ReelClip,
  type Transition,
} from "@/lib/reel/recipe";
import { clipLength } from "@/lib/reel/timeline";
import type { EditorAction } from "@/lib/studio/reelEditor";
import { Switch } from "../../ui";
import { TrashIcon } from "../../icons";
import { DuplicateIcon } from "./icons";
import { Choice, FIT_LABEL, Group, MOTION_LABEL, POSITION_LABEL, Seconds, Slider, TEXT_SIZE_LABEL, TEXT_STYLE_LABEL, TRANSITION_LABEL, pct } from "./fields";
import { TrimScrubber } from "./TrimScrubber";

// Everything about one clip: trim (videos) or how long it shows (stills),
// speed, motion, fit, its text, the transition into it and its own sound.
// Shown in the desktop side pane and in a sheet on phones.

const SPEEDS = ["0.5", "0.75", "1", "1.25", "1.5", "2"] as const;
const KIND_LABEL: Record<ReelClip["source"]["kind"], string> = {
  listingVideo: "Listing video",
  screenshot: "Screenshot",
  graphic: "Graphic",
  "upload-video": "Uploaded video",
  "upload-image": "Uploaded picture",
};

/** The transition into a clip: type and length. */
export function TransitionFields({ value, onChange, first, effectiveSec }: { value: Transition; onChange: (t: Partial<Transition>) => void; first: boolean; effectiveSec?: number }) {
  if (first) return <p className="st-note">The first clip starts the reel, so it has no transition. Use a video fade-in (Reel settings) instead.</p>;
  return (
    <>
      <Choice
        label="Type"
        options={TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABEL[t] }))}
        value={value.type}
        onChange={(type) => onChange({ type, durationSec: type === "cut" ? 0 : value.durationSec || 0.4 })}
      />
      {value.type !== "cut" && (
        <Slider
          label="Length"
          value={value.durationSec}
          min={0.1}
          max={LIMITS.transitionMaxSec}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(durationSec) => onChange({ durationSec })}
          hint={
            effectiveSec !== undefined && effectiveSec + 0.01 < value.durationSec
              ? `Plays ${effectiveSec.toFixed(2)} s: a transition takes at most half of the shorter clip.`
              : undefined
          }
        />
      )}
    </>
  );
}

type Props = {
  clip: ReelClip;
  index: number;
  /** How long the transition into it really plays (the timeline's transIn). */
  transInSec: number;
  problems: string[];
  broken: boolean;
  dispatch: (a: EditorAction) => void;
  /** Phone sheet: duplicate / delete live in the footer instead. */
  compact?: boolean;
};

export const ClipPanel = memo(function ClipPanel({ clip, index, transInSec, problems, broken, dispatch, compact }: Props) {
  const ids = { text: useId() };
  const video = isVideoClip(clip);
  const update = (patch: Extract<EditorAction, { type: "updateClip" }>["patch"]) => dispatch({ type: "updateClip", id: clip.id, patch });
  const len = clipLength(clip);

  return (
    <div className="st-re-panel">
      <div className="st-re-clip-head">
        <div>
          <p className="st-eyebrow">
            <b>Clip {index + 1}</b>
            <span>{KIND_LABEL[clip.source.kind]}</span>
          </p>
          <p className="st-re-clip-title">{clip.source.label ?? KIND_LABEL[clip.source.kind]}</p>
        </div>
        <span className="st-badge st-tnum" data-tone="mute">
          {len.toFixed(1)} s
        </span>
      </div>

      {broken && (
        <p className="st-callout" data-tone="error" role="alert">
          This source can&apos;t be loaded. Remove the clip or check the file.
        </p>
      )}
      {problems.length > 0 && (
        <div className="st-callout" data-tone="error" role="alert">
          <span>{problems.join(" ")}</span>
        </div>
      )}

      {video ? (
        <Group title="Trim">
          <TrimScrubber clip={clip} onTrim={update} />
        </Group>
      ) : (
        <Group title="On screen">
          <Seconds label="Show for" value={clip.durationSec} min={LIMITS.stillMinSec} max={LIMITS.stillMaxSec} step={0.5} onChange={(durationSec) => update({ durationSec })} />
        </Group>
      )}

      {video && (
        <Group title="Speed">
          <Choice
            label="Playback speed"
            options={SPEEDS.map((s): { value: string; label: string } => ({ value: s, label: `${s}×` }))}
            // A custom speed (the slider, or Claude) presses no chip, so every chip, 1× too, can set it back.
            value={(SPEEDS as readonly string[]).includes(String(clip.speed)) ? String(clip.speed) : "custom"}
            onChange={(s) => update({ speed: Number(s) })}
          />
          <Slider label="Exact speed" value={clip.speed} min={LIMITS.speedMin} max={LIMITS.speedMax} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => update({ speed })} />
        </Group>
      )}

      <Group title="Picture">
        <Choice label="Fit" columns={3} options={FITS.map((f) => ({ value: f, label: FIT_LABEL[f].label, hint: FIT_LABEL[f].hint }))} value={clip.fit} onChange={(fit) => update({ fit })} />
        <Choice label="Motion" options={MOTIONS.map((m) => ({ value: m, label: MOTION_LABEL[m] }))} value={clip.motion} onChange={(motion) => update({ motion })} />
      </Group>

      <Group title="Text">
        <Switch checked={clip.text.on} onChange={(on) => update({ text: { ...clip.text, on } })} label="Show text" hint="On top of this clip" />
        {clip.text.on && (
          <>
            <div className="st-field">
              <label className="st-label" htmlFor={ids.text}>
                <span>Text</span>
                <span className="st-counter st-tnum" data-state={clip.text.text.length > LIMITS.textChars * 0.9 ? "near" : undefined}>
                  {clip.text.text.length}/{LIMITS.textChars}
                </span>
              </label>
              <textarea
                id={ids.text}
                className="st-input"
                rows={2}
                maxLength={LIMITS.textChars}
                value={clip.text.text}
                placeholder="A few words"
                onChange={(e) => update({ text: { ...clip.text, text: e.target.value } })}
              />
            </div>
            <Choice label="Position" columns={3} options={TEXT_POSITIONS.map((p) => ({ value: p, label: POSITION_LABEL[p] }))} value={clip.text.position} onChange={(position) => update({ text: { ...clip.text, position } })} />
            <Choice label="Style" options={TEXT_STYLES.map((s) => ({ value: s, label: TEXT_STYLE_LABEL[s] }))} value={clip.text.style} onChange={(style) => update({ text: { ...clip.text, style } })} />
            <Choice label="Size" columns={3} options={TEXT_SIZES.map((s) => ({ value: s, label: TEXT_SIZE_LABEL[s] }))} value={clip.text.size} onChange={(size) => update({ text: { ...clip.text, size } })} />
          </>
        )}
      </Group>

      <Group title="Transition in">
        <TransitionFields value={clip.transitionIn} first={index === 0} effectiveSec={transInSec} onChange={(t) => update({ transitionIn: { ...clip.transitionIn, ...t } })} />
      </Group>

      {video && (
        <Group title="Sound">
          <Switch
            checked={clip.audio.on}
            onChange={(on) => update({ audio: { ...clip.audio, on } })}
            label="Clip's own sound"
            hint={clip.source.kind === "listingVideo" ? "Listing previews are usually silent" : undefined}
          />
          {clip.audio.on && <Slider label="Volume" value={clip.audio.gain} min={0} max={LIMITS.gainMax} step={0.05} format={pct} onChange={(gain) => update({ audio: { ...clip.audio, gain } })} />}
        </Group>
      )}

      {!compact && (
        <div className="st-sheet-foot">
          <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => dispatch({ type: "duplicateClip", id: clip.id })}>
            <DuplicateIcon size={18} />
            Duplicate
          </button>
          <button type="button" className="st-btn st-btn-ghost st-btn-sm st-btn-danger" onClick={() => dispatch({ type: "removeClip", id: clip.id })}>
            <TrashIcon size={18} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
});
