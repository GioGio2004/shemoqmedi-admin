"use client";

import { useId } from "react";
import { TIERS, type FieldSpec } from "@/lib/graphics/spec";

/** One text field of a template: tier chips, a multi-line box or a line. Every key redraws the preview. */
export function TextField({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (v: string) => void }) {
  const id = useId();
  if (field.options) {
    return (
      <div className="st-field" role="group" aria-labelledby={id}>
        <span id={id} className="st-label">
          {field.label}
        </span>
        <div className="st-row">
          {field.options.map((o) => (
            <button key={o} type="button" className="st-chip st-chip-sm" aria-pressed={value === o} onClick={() => onChange(o)} title={o in TIERS ? TIERS[o as keyof typeof TIERS] : o}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="st-field">
      <label className="st-label" htmlFor={id}>
        <span>{field.label}</span>
      </label>
      {field.long ? (
        <textarea id={id} className="st-input" rows={3} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} style={{ minHeight: 88 }} />
      ) : (
        <input id={id} className="st-input" value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      )}
    </div>
  );
}

/** The screenshots of the chosen listing; the picked one is the graphic's image. */
export function ShotPicker({ shots, value, onPick }: { shots: string[]; value: string | null; onPick: (url: string) => void }) {
  const id = useId();
  if (shots.length <= 1) return null;
  return (
    <div className="st-field" role="group" aria-labelledby={id}>
      <span id={id} className="st-label">
        Screenshot
      </span>
      <div className="st-shots">
        {shots.map((url, i) => (
          <button key={url} type="button" aria-pressed={url === value} onClick={() => onPick(url)} aria-label={`Screenshot ${i + 1}`}>
            <img src={url} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
    </div>
  );
}
