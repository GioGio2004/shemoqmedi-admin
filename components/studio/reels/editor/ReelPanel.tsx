"use client";

import { memo, useId } from "react";
import { ASPECT_IDS, LIMITS, type ReelRecipe } from "@/lib/reel/recipe";
import { formatSec, timelineOf, type EditorAction } from "@/lib/studio/reelEditor";
import { ASPECT_LABEL, Choice, Group, Slider } from "./fields";

// The whole reel: its name, shape (9:16, 4:5, 1:1, 16:9) and the fades at the
// start and end, for the picture and for the sound.

const fade = (v: number) => (v > 0 ? `${v.toFixed(1)} s` : "Off");

export const ReelPanel = memo(function ReelPanel({ recipe, title, dispatch }: { recipe: ReelRecipe; title: string; dispatch: (a: EditorAction) => void }) {
  const titleId = useId();
  const f = recipe.fades;
  const sec = timelineOf(recipe).durationSec;
  return (
    <div className="st-re-panel">
      <Group title="Reel">
        <div className="st-field">
          <label className="st-label" htmlFor={titleId}>
            <span>Name</span>
            <span className="st-note">Only you see it</span>
          </label>
          <input id={titleId} className="st-input" value={title} maxLength={LIMITS.titleChars} placeholder="New reel" onChange={(e) => dispatch({ type: "setTitle", title: e.target.value })} />
        </div>
        <Choice
          label="Shape"
          columns={4}
          options={ASPECT_IDS.map((a) => ({ value: a, label: ASPECT_LABEL[a].label, hint: ASPECT_LABEL[a].hint }))}
          value={recipe.reel.aspect}
          onChange={(aspect) => dispatch({ type: "setAspect", aspect })}
        />
        <p className="st-note st-tnum">
          {formatSec(sec)} · {recipe.clips.length} {recipe.clips.length === 1 ? "clip" : "clips"} · 30 fps. Stories take 9:16 and 3 to 60 s.
        </p>
      </Group>
      <Group title="Picture fades">
        <Slider label="From black at the start" value={f.videoInSec} min={0} max={LIMITS.fadeMaxSec} step={0.1} format={fade} onChange={(videoInSec) => dispatch({ type: "setFades", patch: { videoInSec } })} />
        <Slider label="To black at the end" value={f.videoOutSec} min={0} max={LIMITS.fadeMaxSec} step={0.1} format={fade} onChange={(videoOutSec) => dispatch({ type: "setFades", patch: { videoOutSec } })} />
      </Group>
      <Group title="Sound fades">
        <Slider label="Fade in" value={f.audioInSec} min={0} max={LIMITS.fadeMaxSec} step={0.1} format={fade} onChange={(audioInSec) => dispatch({ type: "setFades", patch: { audioInSec } })} />
        <Slider label="Fade out" value={f.audioOutSec} min={0} max={LIMITS.fadeMaxSec} step={0.1} format={fade} onChange={(audioOutSec) => dispatch({ type: "setFades", patch: { audioOutSec } })} />
      </Group>
    </div>
  );
});
