"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/storefront";
import { showAlert, showError } from "./Alerts";
import { Select } from "./Select";
import { GUIDE_AREAS, GUIDE_ROLES, areaLabel, roleLabel, type GuideArea, type GuideRole } from "./guideLabels";

/** Toggle buttons for who a guide is for (at least one stays on). */
export function RolePicker({ value, onChange, labelledBy }: { value: GuideRole[]; onChange: (v: GuideRole[]) => void; labelledBy: string }) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {GUIDE_ROLES.map((r) => {
        const on = value.includes(r.value);
        return (
          <button
            key={r.value}
            type="button"
            className="admin-toggle"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== r.value) : [...value, r.value])}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function NewGuide({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const create = useMutation(api.guides.create);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [area, setArea] = useState<GuideArea>("networking");
  const [roles, setRoles] = useState<GuideRole[]>(["everyone"]);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roles.length) return showAlert("Pick who the guide is for.");
    setBusy(true);
    try {
      const slug = await create({ title, summary: summary || undefined, area, roles });
      router.push(`/guides/${slug}?edit=1`);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="admin-panel grid gap-5" aria-labelledby={`${id}-h`}>
      <p id={`${id}-h`} className="admin-eyebrow">
        New guide
      </p>
      <label className="grid gap-2">
        <span className="admin-eyebrow">Title</span>
        <input
          className="admin-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="How to post a listing on Instagram"
          maxLength={120}
          required
          autoFocus
        />
      </label>
      <label className="grid gap-2">
        <span className="admin-eyebrow">When to use it (optional)</span>
        <input
          className="admin-input"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One line the team reads in the list"
          maxLength={280}
        />
      </label>
      <div className="grid gap-5 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="grid gap-2">
          <span id={`${id}-area`} className="admin-eyebrow">
            Area
          </span>
          <Select value={area} onChange={(v) => setArea(v as GuideArea)} options={GUIDE_AREAS} labelledBy={`${id}-area`} />
        </div>
        <div className="grid gap-2">
          <span id={`${id}-roles`} className="admin-eyebrow">
            For
          </span>
          <RolePicker value={roles} onChange={setRoles} labelledBy={`${id}-roles`} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="admin-button" disabled={busy || !title.trim()}>
          {busy ? "Creating…" : "Create and add sections"}
        </button>
        <button type="button" className="admin-button admin-button-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Starters() {
  const missing = useQuery(api.guides.missingStarters, {});
  const add = useMutation(api.guides.addStarters);
  const [busy, setBusy] = useState(false);
  if (!missing?.length) return null;
  return (
    <section className="admin-panel grid gap-3" aria-label="Starter guides">
      <p className="admin-eyebrow">Starter guides</p>
      <p className="text-sm opacity-70">
        Ready-written guides not added yet: {missing.map((m) => m.title).join(" · ")}. Adding them never overwrites a guide
        you already have; after that they&apos;re yours to edit here.
      </p>
      <div>
        <button
          type="button"
          className="admin-button admin-button-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const n = await add({});
              showAlert(`Added ${n} guide${n === 1 ? "" : "s"}.`, "success");
            } catch (err) {
              showError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : `Add ${missing.length} starter guide${missing.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}

/** Every team guide, filtered by area, role and a search, with "New guide". */
export function Guides() {
  const guides = useQuery(api.guides.list, {});
  const [creating, setCreating] = useState(false);
  const [area, setArea] = useState<GuideArea | "all">("all");
  const [role, setRole] = useState<GuideRole | "all">("all");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (guides ?? [])
      .filter((g) => area === "all" || g.area === area)
      .filter((g) => role === "all" || g.roles.includes(role) || g.roles.includes("everyone"))
      .filter((g) => !q || `${g.title} ${g.summary ?? ""}`.toLowerCase().includes(q));
  }, [guides, area, role, search]);

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Team</p>
          <h1>Guides.</h1>
          <p>
            How-tos for the team: what to send, where to click, step by step. Each guide has sections with text, screenshots
            and copy-ready messages. Changes show at once, no deploy. How the platform itself works is on the docs site.
          </p>
        </div>
        {!creating && (
          <button type="button" className="admin-button" onClick={() => setCreating(true)}>
            New guide
          </button>
        )}
      </div>

      <div className="grid gap-6">
        {creating && <NewGuide onClose={() => setCreating(false)} />}
        <Starters />

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Area">
            <button type="button" className="admin-toggle" aria-pressed={area === "all"} onClick={() => setArea("all")}>
              All areas
            </button>
            {GUIDE_AREAS.map((a) => (
              <button key={a.value} type="button" className="admin-toggle" aria-pressed={area === a.value} onClick={() => setArea(a.value)}>
                {a.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="For">
            <button type="button" className="admin-toggle" aria-pressed={role === "all"} onClick={() => setRole("all")}>
              Anyone
            </button>
            {GUIDE_ROLES.filter((r) => r.value !== "everyone").map((r) => (
              <button key={r.value} type="button" className="admin-toggle" aria-pressed={role === r.value} onClick={() => setRole(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="admin-input max-w-md"
            placeholder="Search guides"
            aria-label="Search guides"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {guides === undefined ? (
          <p className="admin-eyebrow">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="admin-empty">
            {guides.length === 0 ? "No guides yet. Press New guide, or add the starter guides above." : "No guide matches these filters."}
          </div>
        ) : (
          <ul className="grid gap-3">
            {shown.map((g) => (
              <li key={g.id}>
                <Link href={`/guides/${g.slug}`} className="guide-card">
                  <div className="grid min-w-0 gap-2">
                    <p className="admin-eyebrow">
                      {areaLabel(g.area)} · {g.roles.map(roleLabel).join(", ")}
                    </p>
                    <h2>{g.title}</h2>
                    {g.summary && <p>{g.summary}</p>}
                  </div>
                  <div className="guide-card-end">
                    {g.status === "draft" && <span className="admin-tag">Draft</span>}
                    <span className="admin-mono opacity-60">
                      {g.sections} section{g.sections === 1 ? "" : "s"} · {formatDate(g.updatedAt)}
                    </span>
                    <span className="admin-arrow" aria-hidden="true">
                      →
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
