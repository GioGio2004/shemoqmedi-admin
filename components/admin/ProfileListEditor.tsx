"use client";

import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import { LIMITS } from "@/convex/lib/taxonomy";

// Experience and Work lists on a jury profile. Rows are edited as plain
// strings; cleanExperience / cleanWork turn them into what the server takes.

export type JurorExperience = NonNullable<FunctionArgs<typeof api.jury.updateJuror>["experience"]>[number];
export type JurorWork = NonNullable<FunctionArgs<typeof api.jury.updateJuror>["work"]>[number];

export type ExperienceDraft = { key: string; title: string; organization: string; period: string };
export type WorkDraft = { key: string; title: string; url: string; year: string; description: string };

const WORK_DESCRIPTION = 200;

let nextKey = 0;
const newKey = () => `new-${nextKey++}`;

/** Saved rows as drafts. Keys are positional so they stay stable across renders. */
export function experienceDrafts(rows: JurorExperience[]): ExperienceDraft[] {
  return rows.map((r, i) => ({ key: `saved-${i}`, title: r.title, organization: r.organization, period: r.period ?? "" }));
}

export function workDrafts(rows: JurorWork[]): WorkDraft[] {
  return rows.map((r, i) => ({
    key: `saved-${i}`,
    title: r.title,
    url: r.url ?? "",
    year: r.year ?? "",
    description: r.description ?? "",
  }));
}

/** Trimmed rows, fully empty ones dropped, optional fields left out when blank. */
export function cleanExperience(rows: ExperienceDraft[]): JurorExperience[] {
  return rows
    .map((r) => ({ title: r.title.trim(), organization: r.organization.trim(), period: r.period.trim() }))
    .filter((r) => r.title || r.organization || r.period)
    .map((r) => ({ title: r.title, organization: r.organization, ...(r.period ? { period: r.period } : {}) }));
}

export function cleanWork(rows: WorkDraft[]): JurorWork[] {
  return rows
    .map((r) => ({ title: r.title.trim(), url: r.url.trim(), year: r.year.trim(), description: r.description.trim() }))
    .filter((r) => r.title || r.url || r.year || r.description)
    .map((r) => ({
      title: r.title,
      ...(r.url ? { url: r.url } : {}),
      ...(r.year ? { year: r.year } : {}),
      ...(r.description ? { description: r.description } : {}),
    }));
}

export function listsProblem(experience: ExperienceDraft[], work: WorkDraft[]): string | null {
  if (cleanExperience(experience).some((r) => !r.title || !r.organization)) {
    return "Each experience entry needs a role and an organisation.";
  }
  if (cleanWork(work).some((r) => !r.title)) return "Each work entry needs a title.";
  return null;
}

/** Same rows after cleaning (used to send a list only when it changed). */
export function sameRows(a: object[], b: object[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="admin-button admin-button-secondary self-end" aria-label={label} onClick={onClick}>
      Remove
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  url = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder: string;
  url?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs text-black/55">{label}</span>
      <input
        type="text"
        inputMode={url ? "url" : undefined}
        autoComplete="off"
        spellCheck={url ? false : undefined}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="admin-input"
        placeholder={placeholder}
      />
    </label>
  );
}

function ListFrame({
  legend,
  count,
  max,
  addLabel,
  onAdd,
  children,
}: {
  legend: string;
  count: number;
  max: number;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="admin-eyebrow mb-3">{legend}</legend>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="admin-toggle" disabled={count >= max} onClick={onAdd}>
          {addLabel}
        </button>
        <span className="admin-mono text-black/55">
          {count}/{max}
        </span>
      </div>
    </fieldset>
  );
}

export function ExperienceEditor({
  rows,
  onChange,
}: {
  rows: ExperienceDraft[];
  onChange: (rows: ExperienceDraft[]) => void;
}) {
  const patch = (key: string, field: "title" | "organization" | "period", value: string) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  return (
    <ListFrame
      legend="Experience (optional)"
      count={rows.length}
      max={LIMITS.juryExperience}
      addLabel="Add experience"
      onAdd={() => onChange([...rows, { key: newKey(), title: "", organization: "", period: "" }])}
    >
      {rows.map((r, i) => (
        <div
          key={r.key}
          className="grid gap-3 rounded-2xl border border-black/10 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_auto]"
        >
          <Field label="Role" value={r.title} onChange={(v) => patch(r.key, "title", v)} maxLength={80} placeholder="Art Director" />
          <Field
            label="Organisation"
            value={r.organization}
            onChange={(v) => patch(r.key, "organization", v)}
            maxLength={80}
            placeholder="Studio Nord"
          />
          <Field
            label="Period (optional)"
            value={r.period}
            onChange={(v) => patch(r.key, "period", v)}
            maxLength={40}
            placeholder="2019 – present"
          />
          <RemoveButton label={`Remove experience ${i + 1}`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
        </div>
      ))}
    </ListFrame>
  );
}

export function WorkEditor({ rows, onChange }: { rows: WorkDraft[]; onChange: (rows: WorkDraft[]) => void }) {
  const patch = (key: string, field: "title" | "url" | "year" | "description", value: string) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  return (
    <ListFrame
      legend="Work (optional)"
      count={rows.length}
      max={LIMITS.juryWork}
      addLabel="Add work"
      onAdd={() => onChange([...rows, { key: newKey(), title: "", url: "", year: "", description: "" }])}
    >
      {rows.map((r, i) => (
        <div key={r.key} className="grid gap-3 rounded-2xl border border-black/10 p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px_auto]">
            <Field label="Title" value={r.title} onChange={(v) => patch(r.key, "title", v)} maxLength={80} placeholder="Nord rebrand" />
            <Field
              label="Link (optional)"
              value={r.url}
              onChange={(v) => patch(r.key, "url", v)}
              maxLength={LIMITS.url}
              placeholder="https://…"
              url
            />
            <Field label="Year (optional)" value={r.year} onChange={(v) => patch(r.key, "year", v)} maxLength={20} placeholder="2024" />
            <RemoveButton label={`Remove work ${i + 1}`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
          </div>
          <label className="grid gap-1">
            <span className="flex items-baseline justify-between gap-3 text-xs text-black/55">
              Short description (optional)
              <span className="admin-mono">
                {r.description.length}/{WORK_DESCRIPTION}
              </span>
            </span>
            <input
              type="text"
              maxLength={WORK_DESCRIPTION}
              value={r.description}
              onChange={(e) => patch(r.key, "description", e.target.value)}
              className="admin-input"
              placeholder="What it was and their part in it."
            />
          </label>
        </div>
      ))}
    </ListFrame>
  );
}
