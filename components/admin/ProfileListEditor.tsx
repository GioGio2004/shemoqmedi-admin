"use client";

import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import { LIMITS } from "@/convex/lib/taxonomy";

// Experience, Education and Work lists on a jury profile. Rows are edited as
// plain strings; cleanExperience / cleanEducation / cleanWork turn them into
// what the server takes (the server checks the dates and sorts newest first).

export type JurorExperience = NonNullable<FunctionArgs<typeof api.jury.updateJuror>["experience"]>[number];
export type JurorEducation = NonNullable<FunctionArgs<typeof api.jury.updateJuror>["education"]>[number];
export type JurorWork = NonNullable<FunctionArgs<typeof api.jury.updateJuror>["work"]>[number];

export type ExperienceDraft = {
  key: string;
  title: string;
  organization: string;
  organizationUrl: string;
  location: string;
  startMonth: string; // "" or "1"–"12"
  startYear: string;
  endMonth: string;
  endYear: string;
  current: boolean;
  description: string;
  period: string; // legacy free text, kept until dates are set
};
export type EducationDraft = { key: string; school: string; degree: string; field: string; startYear: string; endYear: string };
export type WorkDraft = { key: string; title: string; url: string; year: string; description: string };

const WORK_DESCRIPTION = 200;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let nextKey = 0;
const newKey = () => `new-${nextKey++}`;

const str = (n: number | undefined) => (n === undefined ? "" : String(n));
const num = (s: string) => (s.trim() ? Number(s) : undefined);

const EMPTY_EXPERIENCE: Omit<ExperienceDraft, "key"> = {
  title: "",
  organization: "",
  organizationUrl: "",
  location: "",
  startMonth: "",
  startYear: "",
  endMonth: "",
  endYear: "",
  current: false,
  description: "",
  period: "",
};

/** Saved rows as drafts. Keys are positional so they stay stable across renders. */
export function experienceDrafts(rows: JurorExperience[]): ExperienceDraft[] {
  return rows.map((r, i) => ({
    key: `saved-${i}`,
    title: r.title,
    organization: r.organization,
    organizationUrl: r.organizationUrl ?? "",
    location: r.location ?? "",
    startMonth: str(r.startMonth),
    startYear: str(r.startYear),
    endMonth: str(r.endMonth),
    endYear: str(r.endYear),
    current: r.current ?? false,
    description: r.description ?? "",
    period: r.period ?? "",
  }));
}

export function educationDrafts(rows: JurorEducation[]): EducationDraft[] {
  return rows.map((r, i) => ({
    key: `saved-${i}`,
    school: r.school,
    degree: r.degree ?? "",
    field: r.field ?? "",
    startYear: str(r.startYear),
    endYear: str(r.endYear),
  }));
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
  const out: JurorExperience[] = [];
  for (const r of rows) {
    const t = {
      title: r.title.trim(),
      organization: r.organization.trim(),
      organizationUrl: r.organizationUrl.trim(),
      location: r.location.trim(),
      description: r.description.trim(),
      period: r.period.trim(),
    };
    const startYear = num(r.startYear);
    const startMonth = startYear !== undefined ? num(r.startMonth) : undefined;
    const endYear = r.current ? undefined : num(r.endYear);
    const endMonth = endYear !== undefined ? num(r.endMonth) : undefined;
    const empty = !t.title && !t.organization && !t.organizationUrl && !t.location && !t.description;
    if (empty && startYear === undefined && endYear === undefined && !r.current) continue;
    out.push({
      title: t.title,
      organization: t.organization,
      ...(t.organizationUrl ? { organizationUrl: t.organizationUrl } : {}),
      ...(t.location ? { location: t.location } : {}),
      ...(startYear !== undefined ? { startYear } : {}),
      ...(startMonth !== undefined ? { startMonth } : {}),
      ...(endYear !== undefined ? { endYear } : {}),
      ...(endMonth !== undefined ? { endMonth } : {}),
      ...(r.current ? { current: true } : {}),
      ...(t.description ? { description: t.description } : {}),
      ...(t.period && startYear === undefined ? { period: t.period } : {}),
    });
  }
  return out;
}

export function cleanEducation(rows: EducationDraft[]): JurorEducation[] {
  return rows
    .map((r) => ({
      school: r.school.trim(),
      degree: r.degree.trim(),
      field: r.field.trim(),
      startYear: num(r.startYear),
      endYear: num(r.endYear),
    }))
    .filter((r) => r.school || r.degree || r.field || r.startYear !== undefined || r.endYear !== undefined)
    .map((r) => ({
      school: r.school,
      ...(r.degree ? { degree: r.degree } : {}),
      ...(r.field ? { field: r.field } : {}),
      ...(r.startYear !== undefined ? { startYear: r.startYear } : {}),
      ...(r.endYear !== undefined ? { endYear: r.endYear } : {}),
    }));
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

const ym = (year: number, month: number | undefined, fallback: number) => year * 12 + (month ?? fallback);

/** What the server would refuse, explained before saving. */
export function listsProblem(
  experience: ExperienceDraft[],
  work: WorkDraft[],
  education: EducationDraft[] = [],
): string | null {
  for (const r of cleanExperience(experience)) {
    if (!r.title || !r.organization) return "Each experience entry needs a role and a company.";
    if ((r.current || r.endYear !== undefined) && r.startYear === undefined) return `Add the start year for ${r.title}.`;
    if (
      r.startYear !== undefined &&
      r.endYear !== undefined &&
      ym(r.endYear, r.endMonth, 12) < ym(r.startYear, r.startMonth, 1)
    ) {
      return `${r.title} ends before it starts.`;
    }
  }
  for (const r of cleanEducation(education)) {
    if (!r.school) return "Each education entry needs a school.";
    if (r.startYear !== undefined && r.endYear !== undefined && r.endYear < r.startYear) return `${r.school} ends before it starts.`;
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

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs text-black/55">{label}</span>
      <select className="admin-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const MONTH_OPTIONS = [{ value: "", label: "Month" }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))];

/** Years from this year (plus `ahead`, for expected graduations) back to LIMITS.juryEarliestYear. */
function yearOptions(ahead = 0) {
  const top = new Date().getFullYear() + ahead;
  const years = Array.from({ length: top - LIMITS.juryEarliestYear + 1 }, (_, i) => String(top - i));
  return [{ value: "", label: "Year" }, ...years.map((y) => ({ value: y, label: y }))];
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
  const patch = <K extends keyof ExperienceDraft>(key: string, field: K, value: ExperienceDraft[K]) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const years = yearOptions();

  return (
    <ListFrame
      legend="Experience (optional, sorted newest first on save)"
      count={rows.length}
      max={LIMITS.juryExperience}
      addLabel="Add experience"
      onAdd={() => onChange([...rows, { key: newKey(), ...EMPTY_EXPERIENCE }])}
    >
      {rows.map((r, i) => (
        <div key={r.key} className="grid gap-3 rounded-2xl border border-black/10 p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field label="Role" value={r.title} onChange={(v) => patch(r.key, "title", v)} maxLength={80} placeholder="Art Director" />
            <Field
              label="Company"
              value={r.organization}
              onChange={(v) => patch(r.key, "organization", v)}
              maxLength={80}
              placeholder="Studio Nord"
            />
            <RemoveButton label={`Remove experience ${i + 1}`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Company website (optional)"
              value={r.organizationUrl}
              onChange={(v) => patch(r.key, "organizationUrl", v)}
              maxLength={LIMITS.url}
              placeholder="https://…"
              url
            />
            <Field
              label="Location (optional)"
              value={r.location}
              onChange={(v) => patch(r.key, "location", v)}
              maxLength={80}
              placeholder="Tbilisi, Georgia · Remote"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Select label="Start month" value={r.startMonth} onChange={(v) => patch(r.key, "startMonth", v)} options={MONTH_OPTIONS} />
            <Select label="Start year" value={r.startYear} onChange={(v) => patch(r.key, "startYear", v)} options={years} />
            <Select
              label="End month"
              value={r.current ? "" : r.endMonth}
              disabled={r.current}
              onChange={(v) => patch(r.key, "endMonth", v)}
              options={MONTH_OPTIONS}
            />
            <Select
              label="End year"
              value={r.current ? "" : r.endYear}
              disabled={r.current}
              onChange={(v) => patch(r.key, "endYear", v)}
              options={years}
            />
          </div>
          <label className="admin-check">
            <input type="checkbox" checked={r.current} onChange={(e) => patch(r.key, "current", e.target.checked)} />
            <span>Currently in this role</span>
          </label>
          {r.period && !r.startYear && (
            <p className="text-xs text-black/55">
              Saved as &ldquo;{r.period}&rdquo;. Pick a start year to replace it with real dates.
            </p>
          )}
          <label className="grid gap-1">
            <span className="flex items-baseline justify-between gap-3 text-xs text-black/55">
              Description (optional)
              <span className="admin-mono">
                {r.description.length}/{LIMITS.juryExperienceDescription}
              </span>
            </span>
            <textarea
              rows={3}
              maxLength={LIMITS.juryExperienceDescription}
              value={r.description}
              onChange={(e) => patch(r.key, "description", e.target.value)}
              className="admin-input resize-y"
              placeholder="What they led or built there."
            />
          </label>
        </div>
      ))}
    </ListFrame>
  );
}

export function EducationEditor({ rows, onChange }: { rows: EducationDraft[]; onChange: (rows: EducationDraft[]) => void }) {
  const patch = (key: string, field: keyof Omit<EducationDraft, "key">, value: string) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const startYears = yearOptions();
  const endYears = yearOptions(8);

  return (
    <ListFrame
      legend="Education (optional)"
      count={rows.length}
      max={LIMITS.juryEducation}
      addLabel="Add education"
      onAdd={() => onChange([...rows, { key: newKey(), school: "", degree: "", field: "", startYear: "", endYear: "" }])}
    >
      {rows.map((r, i) => (
        <div key={r.key} className="grid gap-3 rounded-2xl border border-black/10 p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Field
              label="School"
              value={r.school}
              onChange={(v) => patch(r.key, "school", v)}
              maxLength={100}
              placeholder="Tbilisi State Academy of Arts"
            />
            <RemoveButton label={`Remove education ${i + 1}`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Degree (optional)" value={r.degree} onChange={(v) => patch(r.key, "degree", v)} maxLength={80} placeholder="MA" />
            <Field
              label="Field (optional)"
              value={r.field}
              onChange={(v) => patch(r.key, "field", v)}
              maxLength={80}
              placeholder="Graphic design"
            />
            <Select label="Start year" value={r.startYear} onChange={(v) => patch(r.key, "startYear", v)} options={startYears} />
            <Select label="End year (or expected)" value={r.endYear} onChange={(v) => patch(r.key, "endYear", v)} options={endYears} />
          </div>
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
