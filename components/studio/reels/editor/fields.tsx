"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { CaptionPosition, CaptionStyle, Fit, Motion, ReelAspect, TextPosition, TextSize, TextStyle, TransitionType } from "@/lib/reel/recipe";

// Small controls the reel editor's panels share, drawn with the Studio's
// classes (chips, inputs, insets) and reel-editor.css. 16 px inputs, 44 px
// targets.

/**
 * Calls `flush` when the field's panel goes away, the app is hidden or the
 * page is left. Text kept only in a field (saved on blur) then still reaches
 * the reel when no blur comes: an iPhone sheet swiped down, a suspended PWA.
 */
export function useFlushOnLeave(flush: () => void) {
  const ref = useRef(flush);
  useEffect(() => {
    ref.current = flush;
  });
  useEffect(() => {
    const run = () => ref.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", run);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", run);
      run();
    };
  }, []);
}

export const MOTION_LABEL: Record<Motion, string> = {
  none: "None",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  panLeft: "Pan left",
  panRight: "Pan right",
  panUp: "Pan up",
  panDown: "Pan down",
};

export const FIT_LABEL: Record<Fit, { label: string; hint: string }> = {
  fill: { label: "Fill", hint: "Crop to fill the frame" },
  blur: { label: "Blur", hint: "Whole picture over a blur" },
  letterbox: { label: "Bars", hint: "Whole picture on black" },
};

export const TRANSITION_LABEL: Record<TransitionType, string> = {
  cut: "Cut",
  crossfade: "Crossfade",
  dipBlack: "Dip to black",
  dipWhite: "Dip to white",
  morph: "Morph",
  slideLeft: "Slide left",
  slideRight: "Slide right",
  slideUp: "Slide up",
  pushLeft: "Push left",
  pushRight: "Push right",
  pushUp: "Push up",
};

/** Short names for the chips between timeline cards. */
export const TRANSITION_SHORT: Record<TransitionType, string> = {
  cut: "Cut",
  crossfade: "Fade",
  dipBlack: "Black",
  dipWhite: "White",
  morph: "Morph",
  slideLeft: "Slide ←",
  slideRight: "Slide →",
  slideUp: "Slide ↑",
  pushLeft: "Push ←",
  pushRight: "Push →",
  pushUp: "Push ↑",
};

export const TEXT_STYLE_LABEL: Record<TextStyle, string> = { glass: "Glass", solid: "Black", light: "White", shadow: "Shadow", headline: "Headline" };
export const TEXT_SIZE_LABEL: Record<TextSize, string> = { s: "Small", m: "Medium", l: "Large" };
export const POSITION_LABEL: Record<TextPosition | CaptionPosition, string> = { top: "Top", center: "Middle", bottom: "Bottom" };
export const CAPTION_STYLE_LABEL: Record<CaptionStyle, string> = { glass: "Glass", bold: "Bold", highlight: "Word by word", box: "Black box", light: "White box" };
export const ASPECT_LABEL: Record<ReelAspect, { label: string; hint: string }> = {
  "9:16": { label: "9:16", hint: "Reel, story" },
  "4:5": { label: "4:5", hint: "Feed" },
  "1:1": { label: "1:1", hint: "Square" },
  "16:9": { label: "16:9", hint: "Wide" },
};

/** A titled group inside a panel. */
export function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="st-re-group" aria-labelledby={id}>
      <div className="st-re-group-head">
        <h3 id={id} className="st-re-group-title">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A set of chips, one chosen (aria-pressed), wrapping. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  columns,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  /** Fixed columns (equal widths) instead of wrapping chips. */
  columns?: number;
}) {
  const id = useId();
  return (
    <div className="st-re-field">
      <p id={id} className="st-label">
        <span>{label}</span>
      </p>
      <div className="st-re-choice" role="group" aria-labelledby={id} data-cols={columns} style={columns ? ({ "--cols": columns } as React.CSSProperties) : undefined}>
        {options.map((o) => (
          <button key={o.value} type="button" className="st-chip st-chip-sm st-re-chip" aria-pressed={o.value === value} disabled={disabled} onClick={() => o.value !== value && onChange(o.value)} title={o.hint}>
            {o.label}
            {o.hint && columns ? <small>{o.hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A labelled slider with its value shown (and read out). */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const fill = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0;
  return (
    <div className="st-re-field">
      <label className="st-label" htmlFor={id}>
        <span>{label}</span>
        <span className="st-tnum st-re-val">{format(value)}</span>
      </label>
      <input
        id={id}
        className="st-re-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        style={{ "--fill": fill } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="st-note">{hint}</p>}
    </div>
  );
}

/** Seconds with − / + steps and a typed value (16 px input). */
export function Seconds({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const [text, setTextState] = useState<string | null>(null);
  const textRef = useRef<string | null>(null);
  const setText = (t: string | null) => {
    textRef.current = t;
    setTextState(t);
  };
  const set = (n: number) => onChange(Math.round(Math.min(max, Math.max(min, n)) * 100) / 100);
  /** The typed value into the reel (on blur, Enter, or when the panel goes away). */
  const commit = () => {
    const typed = textRef.current;
    if (typed === null) return;
    const n = Number(typed.replace(",", "."));
    if (Number.isFinite(n)) set(n);
    setText(null);
  };
  useFlushOnLeave(commit);
  return (
    <div className="st-re-field">
      <label className="st-label" htmlFor={id}>
        <span>{label}</span>
        <span className="st-note">s</span>
      </label>
      <div className="st-re-secs">
        <button type="button" className="st-icon-btn" aria-label={`${label}: ${step} s less`} disabled={disabled || value <= min} onClick={() => set(value - step)}>
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={id}
          className="st-input st-tnum"
          inputMode="decimal"
          value={text ?? String(value)}
          disabled={disabled}
          onFocus={() => setText(String(value))}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <button type="button" className="st-icon-btn" aria-label={`${label}: ${step} s more`} disabled={disabled || value >= max} onClick={() => set(value + step)}>
          <span aria-hidden="true">+</span>
        </button>
      </div>
      {hint && <p className="st-note">{hint}</p>}
    </div>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const secs = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} s`;
