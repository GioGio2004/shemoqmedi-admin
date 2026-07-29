"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Glass control kit — iOS-native grouped-inset styling shared by every
// workspace panel. Surfaces are translucent + blurred; the brand accent
// (#D8FF3A) marks selection, white glass marks structure.
// ─────────────────────────────────────────────────────────────────────────────

/** iOS "grouped list" card: uppercase label outside, frosted card inside. */
export function PanelSection({
  index,
  label,
  children,
  hint,
}: {
  index?: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="px-3 pb-5 first:pt-3">
      <div className="mb-2 flex items-baseline gap-2 px-2">
        {index && (
          <span className="font-v-mono text-[10px] tracking-[0.08em] text-v-accent">
            {index}
          </span>
        )}
        <p className="v-t-micro text-v-faint">{label}</p>
        {hint && (
          <span className="ml-auto text-[10px] text-v-faint/70">{hint}</span>
        )}
      </div>
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-2xl">
        {children}
      </div>
    </section>
  );
}

export function Field({
  label,
  children,
  inline = false,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  inline?: boolean;
  hint?: string;
}) {
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-v-mut">
          {label}
          {hint && (
            <span className="mt-0.5 block text-[10px] text-v-faint">{hint}</span>
          )}
        </span>
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-v-mut">{label}</span>
      {hint && <span className="-mt-1 text-[10px] text-v-faint">{hint}</span>}
      {children}
    </div>
  );
}

/** iOS segmented control — recessed track, floating white thumb. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-white/[0.06] bg-black/25 p-1">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            "rounded-lg transition-all",
            size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs",
            value === opt.key
              ? "bg-white/90 font-semibold text-black shadow-sm"
              : "text-v-mut hover:bg-white/[0.08] hover:text-v-ink",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** iOS switch. */
export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-200",
        checked
          ? "border-transparent bg-v-accent"
          : "border-white/10 bg-white/[0.12]",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-[left] duration-200",
          checked ? "left-[19px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/[0.15] accent-[var(--v-accent)]"
      />
      <span className="w-10 shrink-0 text-right font-v-mono text-[11px] tabular-nums text-v-mut">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

/** Color input: swatch + hex readout on a glass chip. */
export function ColorField({
  label,
  value,
  onChange,
  onClear,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onClear?: () => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-v-mut">{label}</span>
      <div className="flex items-center gap-1.5">
        {onClear && value && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-v-faint transition-colors hover:text-v-ink"
          >
            Reset
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
          <span
            className="h-4 w-4 rounded-md border border-white/25"
            style={{ backgroundColor: value || placeholder || "#000000" }}
          />
          <span className="font-v-mono text-[11px] uppercase text-v-mut">
            {value || placeholder || "—"}
          </span>
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-0 w-0 opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

/** Visual option tile with a mini mockup — used for card/hero/template pickers. */
export function OptionTile({
  active,
  label,
  hint,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-1.5 rounded-xl border p-2 text-left transition-all",
        active
          ? "border-v-accent/60 bg-v-accent/[0.10] ring-1 ring-v-accent/30"
          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]",
      )}
    >
      {children !== undefined && (
        <div className="pointer-events-none flex h-14 items-stretch justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-black/30">
          {children}
        </div>
      )}
      <div>
        <p
          className={cn(
            "text-[11px] font-medium leading-tight",
            active ? "text-v-accent" : "text-v-ink",
          )}
        >
          {label}
        </p>
        {hint && (
          <p className="mt-0.5 text-[10px] leading-tight text-v-faint">{hint}</p>
        )}
      </div>
    </button>
  );
}

// ── Form primitives for the content panels ───────────────────────────────────

export function GInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-v-ink placeholder:text-v-faint/60 transition-all focus:border-v-accent/60 focus:bg-black/30 focus:outline-none",
        className,
      )}
    />
  );
}

export function GTextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-v-ink placeholder:text-v-faint/60 transition-all focus:border-v-accent/60 focus:bg-black/30 focus:outline-none",
        className,
      )}
    />
  );
}

export function GSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 pr-10 text-sm text-v-ink transition-all focus:border-v-accent/60 focus:outline-none [color-scheme:dark]"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-v-faint" />
    </div>
  );
}

/** EN / KA / RU switcher for multilingual fields — one field, three tongues. */
export const CONTENT_LANGS = ["en", "ka", "ru"] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];

export function LangSwitch({
  value,
  onChange,
}: {
  value: ContentLang;
  onChange: (l: ContentLang) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-white/[0.06] bg-black/25 p-0.5">
      {CONTENT_LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={cn(
            "rounded-md px-2 py-0.5 font-v-mono text-[10px] uppercase tracking-wide transition-all",
            value === l
              ? "bg-white/90 font-semibold text-black shadow-sm"
              : "text-v-faint hover:text-v-ink",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
