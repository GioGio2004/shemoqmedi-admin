"use client";

import { showError } from "./Alerts";
import Link from "next/link";
import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { JURY_CATEGORIES, LIMITS, type JuryCategory } from "@/convex/lib/taxonomy";
import { formatDate, STOREFRONT_URL } from "@/lib/storefront";
import { ClaimLink, CopyUrl, EmailClaimLink } from "./ClaimLink";
import { MediaPicker, useMediaUpload } from "./MediaUpload";

type Juror = FunctionReturnType<typeof api.jury.adminOverview>[number];
type UpdateArgs = FunctionArgs<typeof api.jury.updateJuror>;

/** The photo shown on the site, or the grey placeholder when there is none. */
export function JurorAvatar({ url, name, size = 44 }: { url: string | null; name: string; size?: number }) {
  return url ? (
    <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full bg-black/10 text-black/40"
      style={{ width: size, height: size }}
      title={name}
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6z" />
      </svg>
    </span>
  );
}

function panelName(category: JuryCategory | null) {
  return JURY_CATEGORIES.find((c) => c.slug === category)?.name ?? "No panel";
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile fields (shared by create and edit)
// ─────────────────────────────────────────────────────────────────────────────

type Draft = {
  name: string;
  title: string;
  category: JuryCategory | "";
  location: string;
  website: string;
  linkedinUrl: string;
  bio: string;
  email: string;
  isFounding: boolean;
};
type DraftKey = keyof Draft;
const DRAFT_KEYS: DraftKey[] = [
  "name",
  "title",
  "category",
  "location",
  "website",
  "linkedinUrl",
  "bio",
  "email",
  "isFounding",
];

const EMPTY_DRAFT: Draft = {
  name: "",
  title: "",
  category: "",
  location: "",
  website: "",
  linkedinUrl: "",
  bio: "",
  email: "",
  isFounding: true,
};

function fromJuror(j: Juror): Draft {
  return {
    name: j.name,
    title: j.title,
    category: j.category ?? "",
    location: j.location ?? "",
    website: j.website ?? "",
    linkedinUrl: j.linkedinUrl ?? "",
    bio: j.bio ?? "",
    // Only the contact email is editable; a claimed juror's account email is shown, not saved back.
    email: j.status === "unclaimed" ? (j.email ?? "") : j.email && j.email !== j.accountEmail ? j.email : "",
    isFounding: j.isFounding,
  };
}

function draftProblem(d: Draft): string | null {
  if (!d.name.trim()) return "Add the juror's name.";
  if (!d.title.trim()) return "Add their role.";
  if (!d.category) return "Pick a jury panel.";
  return null;
}

function ProfileFields({
  draft,
  set,
  idPrefix,
}: {
  draft: Draft;
  set: <K extends DraftKey>(key: K, value: Draft[K]) => void;
  idPrefix: string;
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2">
          <span className="admin-eyebrow">Name</span>
          <input
            required
            maxLength={LIMITS.creditName}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            className="admin-input"
            placeholder="Ana Beridze"
          />
        </label>
        <label className="grid gap-2">
          <span className="admin-eyebrow">Role</span>
          <input
            required
            maxLength={LIMITS.juryTitle}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            className="admin-input"
            placeholder="Design Director, Studio Nord"
          />
        </label>
      </div>

      <fieldset>
        <legend className="admin-eyebrow mb-3">Jury panel</legend>
        <div className="flex flex-wrap gap-2">
          {JURY_CATEGORIES.map((c) => (
            <button
              key={c.slug}
              type="button"
              className="admin-toggle"
              aria-pressed={draft.category === c.slug}
              onClick={() => set("category", c.slug)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2">
          <span className="admin-eyebrow">Location (optional)</span>
          <input
            maxLength={80}
            value={draft.location}
            onChange={(e) => set("location", e.target.value)}
            className="admin-input"
            placeholder="Tbilisi, Georgia"
          />
        </label>
        <label className="grid gap-2">
          <span className="admin-eyebrow">Private email (optional)</span>
          <input
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={draft.email}
            onChange={(e) => set("email", e.target.value)}
            className="admin-input"
            placeholder="ana@studio.ge"
          />
          <span className="text-xs text-black/55">Never shown. Used to email the claim link.</span>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2">
          <span className="admin-eyebrow">Personal website (optional)</span>
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.url}
            value={draft.website}
            onChange={(e) => set("website", e.target.value)}
            className="admin-input"
            placeholder="https://ana.design"
          />
        </label>
        <label className="grid gap-2">
          <span className="admin-eyebrow">LinkedIn URL (optional)</span>
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.url}
            value={draft.linkedinUrl}
            onChange={(e) => set("linkedinUrl", e.target.value)}
            className="admin-input"
            placeholder="https://www.linkedin.com/in/…"
          />
        </label>
      </div>

      <div className="grid gap-2">
        <label htmlFor={`${idPrefix}-bio`} className="flex items-baseline justify-between gap-3">
          <span className="admin-eyebrow">Bio (optional)</span>
          <span className="admin-mono text-black/55">
            {draft.bio.length}/{LIMITS.juryBio}
          </span>
        </label>
        <textarea
          id={`${idPrefix}-bio`}
          rows={3}
          maxLength={LIMITS.juryBio}
          value={draft.bio}
          onChange={(e) => set("bio", e.target.value)}
          className="admin-input resize-y"
          placeholder="A few lines about their work."
        />
      </div>

      <label className="admin-check">
        <input type="checkbox" checked={draft.isFounding} onChange={(e) => set("isFounding", e.target.checked)} />
        <span>
          Founding Jury
          <small>Shows the Founding Jury mark on their profile.</small>
        </span>
      </label>
    </>
  );
}

type Avatar = { file: File | null; error: string | null };
const NO_AVATAR: Avatar = { file: null, error: null };

/** Uploads an avatar once per file, so a retry after a failed save does not upload it again. */
function useAvatarUpload() {
  const uploadFile = useMediaUpload();
  const uploaded = useRef(new Map<File, Id<"media">>());
  return async (file: File, name: string) => {
    const known = uploaded.current.get(file);
    if (known) return known;
    const id = await uploadFile(file, { site: `jury-${name.trim()}`, label: "avatar" });
    uploaded.current.set(file, id);
    return id;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

type Created = { id: Id<"jurors">; name: string; url: string | null };

function CreateJurorForm() {
  const create = useMutation(api.jury.createJuror);
  const updateJuror = useMutation(api.jury.updateJuror);
  const link = useAction(api.claimLinks.link);
  const uploadAvatar = useAvatarUpload();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [avatar, setAvatar] = useState<Avatar>(NO_AVATAR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const submitting = useRef(false);

  function set<K extends DraftKey>(key: K, value: Draft[K]) {
    setError(null);
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || submitting.current) return;
    const problem = draftProblem(draft) ?? avatar.error;
    if (problem) {
      setError(problem);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      // Profile first, photo second: a profile the server rejects never leaves
      // an uploaded photo behind.
      const { id } = await create({
        name: draft.name.trim(),
        title: draft.title.trim(),
        category: draft.category as JuryCategory,
        location: draft.location.trim() || undefined,
        website: draft.website.trim() || undefined,
        linkedinUrl: draft.linkedinUrl.trim() || undefined,
        bio: draft.bio.trim() || undefined,
        email: draft.email.trim() || undefined,
        isFounding: draft.isFounding,
      });
      if (avatar.file) {
        try {
          await updateJuror({ jurorId: id, avatarId: await uploadAvatar(avatar.file, draft.name) });
        } catch (err) {
          showError(err); // the profile exists; add the photo again from Edit
        }
      }
      // Mint the claim link right away; if that fails, the Copy button below can retry.
      let url: string | null = null;
      try {
        url = (await link({ target: { kind: "juror", id } })).url;
      } catch (err) {
        showError(err);
      }
      setCreated({ id, name: draft.name.trim(), url });
      setDraft(EMPTY_DRAFT);
      setAvatar(NO_AVATAR);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <section className="admin-panel grid gap-5" aria-labelledby="create-heading">
      <p id="create-heading" className="admin-eyebrow">
        Create jury profile
      </p>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={busy} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
          <legend className="sr-only">New jury profile</legend>
          <div className="grid min-w-0 gap-4">
            <ProfileFields draft={draft} set={set} idPrefix="new-juror" />
          </div>
          <div className="grid gap-2">
            <MediaPicker
              id="new-juror-avatar"
              label="Photo (optional)"
              hint="Square works best. Their own account photo replaces it once they have one."
              kind="image"
              aspect="1 / 1"
              file={avatar.file}
              onChange={(file, err) => setAvatar({ file, error: err })}
            />
            {avatar.error && <p role="alert" className="text-xs font-medium">{avatar.error}</p>}
          </div>
        </fieldset>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" className="admin-button" disabled={busy}>
            {busy ? "Creating…" : "Create profile"}
          </button>
          {error && (
            <p role="alert" className="text-sm font-medium">
              {error}
            </p>
          )}
        </div>
      </form>

      {created && (
        <div role="status" className="grid gap-3 rounded-2xl border border-black/10 p-4 text-sm">
          <p className="font-medium">{created.name}&apos;s profile is ready. It stays private until they claim it.</p>
          {created.url ? (
            <CopyUrl url={created.url} label="Copy claim link" />
          ) : (
            <ClaimLink target={{ kind: "juror", id: created.id }} />
          )}
          <p className="text-xs text-black/55">
            Bundle their site so the same link claims it:{" "}
            <Link href={`/listings/new?juror=${created.id}`} className="underline underline-offset-4">
              Add their website listing
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit
// ─────────────────────────────────────────────────────────────────────────────

function EditJurorForm({ juror, onDone }: { juror: Juror; onDone: () => void }) {
  const update = useMutation(api.jury.updateJuror);
  const uploadAvatar = useAvatarUpload();
  const saved = fromJuror(juror);
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [avatar, setAvatar] = useState<Avatar>(NO_AVATAR);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: Draft = { ...saved, ...edits };
  const changed = DRAFT_KEYS.filter((k) => {
    const a = draft[k];
    const b = saved[k];
    return typeof a === "string" && typeof b === "string" ? a.trim() !== b.trim() : a !== b;
  });
  const avatarChanged = avatar.file !== null || removeAvatar;
  // Until claimed, the photo shown is the admin avatar (if any).
  const currentAvatar = juror.avatarId && juror.status === "unclaimed" && !removeAvatar ? juror.imageUrl : null;

  function set<K extends DraftKey>(key: K, value: Draft[K]) {
    setError(null);
    setEdits((e) => ({ ...e, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = draftProblem(draft) ?? avatar.error;
    if (problem) {
      setError(problem);
      return;
    }
    if (changed.length === 0 && !avatarChanged) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const args: UpdateArgs = { jurorId: juror.id };
      for (const k of changed) {
        const v = draft[k];
        (args as Record<string, unknown>)[k] = typeof v === "string" ? v.trim() : v;
      }
      if (avatar.file) args.avatarId = await uploadAvatar(avatar.file, draft.name);
      else if (removeAvatar) args.avatarId = null;
      await update(args);
      onDone();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 rounded-2xl border border-black/10 p-4">
      <fieldset disabled={busy} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_200px] lg:items-start">
        <legend className="sr-only">Edit {juror.name}</legend>
        <div className="grid min-w-0 gap-4">
          <ProfileFields draft={draft} set={set} idPrefix={`juror-${juror.id}`} />
        </div>
        <div className="grid gap-2">
          <MediaPicker
            id={`juror-${juror.id}-avatar`}
            label={juror.avatarId ? "Replace photo" : "Photo (optional)"}
            hint={
              juror.status === "claimed"
                ? "Their own account photo is shown instead when they have one."
                : "Square works best."
            }
            kind="image"
            aspect="1 / 1"
            file={avatar.file}
            currentUrl={currentAvatar}
            onChange={(file, err) => {
              setAvatar({ file, error: err });
              if (file) setRemoveAvatar(false);
            }}
          />
          {avatar.error && <p role="alert" className="text-xs font-medium">{avatar.error}</p>}
          {juror.avatarId && !avatar.file && (
            <label className="admin-check">
              <input type="checkbox" checked={removeAvatar} onChange={(e) => setRemoveAvatar(e.target.checked)} />
              <span>Remove the photo</span>
            </label>
          )}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="admin-button" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
        <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={onDone}>
          Cancel
        </button>
        {error && (
          <p role="alert" className="text-sm font-medium">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────────

function StatusChip({ juror }: { juror: Juror }) {
  // Reuses the listing status styles: filled = live, muted = off.
  const [label, status] =
    juror.status === "unclaimed" ? ["Unclaimed", undefined] : juror.active ? ["Claimed", "in_voting"] : ["Off the jury", "rejected"];
  return (
    <span className="admin-status" data-status={status}>
      <span className="admin-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function JurorRow({ juror }: { juror: Juror }) {
  const setActive = useMutation(api.jury.setJurorActive);
  const remove = useMutation(api.jury.deleteJuror);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const unclaimed = juror.status === "unclaimed";

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  function toggleActive() {
    if (juror.active && !confirm(`Take ${juror.name} off the jury? Their evaluations stay on the sites.`)) return;
    void run(() => setActive({ jurorId: juror.id, active: !juror.active }));
  }

  function onDelete() {
    const linked = juror.listings.length
      ? ` Its ${juror.listings.length === 1 ? "listing stays" : `${juror.listings.length} listings stay`}, unlinked.`
      : "";
    if (!confirm(`Delete ${juror.name}'s profile and its claim link?${linked} This can't be undone.`)) return;
    void run(() => remove({ jurorId: juror.id }));
  }

  return (
    <li className="grid gap-4 border-t border-black/10 py-5 first:border-t-0">
      <div className="flex flex-wrap items-start gap-4">
        <JurorAvatar url={juror.imageUrl} name={juror.name} />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="flex flex-wrap items-center gap-3 font-medium">
            {juror.name}
            <StatusChip juror={juror} />
            {juror.isFounding && <span className="admin-tag">Founding</span>}
          </p>
          <p className="text-sm text-black/70">
            {juror.title}
            {juror.location ? ` · ${juror.location}` : ""}
          </p>
          <p className="admin-mono text-xs text-black/55">
            {panelName(juror.category)} · {juror.evaluations}{" "}
            {juror.evaluations === 1 ? "evaluation" : "evaluations"} ·{" "}
            {unclaimed ? `created ${formatDate(juror.joinedAt)}` : `claimed ${formatDate(juror.claimedAt ?? juror.joinedAt)}`}
          </p>
          <p className="text-xs text-black/55">
            {juror.email ?? (unclaimed ? "No email" : "Account deleted")}
            {juror.accountEmail && juror.email !== juror.accountEmail ? ` · account ${juror.accountEmail}` : ""}
          </p>
          {juror.listings.length > 0 && (
            <p className="text-xs text-black/55">
              Listings:{" "}
              {juror.listings.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ", "}
                  <Link href={`/review/${l.id}`} className="underline underline-offset-4">
                    {l.title}
                  </Link>{" "}
                  ({l.isClaimed ? "claimed" : "unclaimed"})
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!unclaimed && juror.active && (
            <a
              href={`${STOREFRONT_URL}/jury/${juror.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="admin-button admin-button-secondary"
            >
              View on site <span aria-hidden="true">↗</span>
            </a>
          )}
          <button
            type="button"
            className="admin-button admin-button-secondary"
            disabled={busy}
            aria-expanded={editing}
            onClick={() => setEditing((on) => !on)}
          >
            Edit
          </button>
          {unclaimed ? (
            <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={onDelete}>
              Delete
            </button>
          ) : (
            <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={toggleActive}>
              {juror.active ? "Remove from jury" : "Restore"}
            </button>
          )}
        </div>
      </div>

      {unclaimed && (
        <div className="grid gap-3 md:grid-cols-2">
          <ClaimLink target={{ kind: "juror", id: juror.id }} token={juror.claimToken} rotatable />
          <EmailClaimLink jurorId={juror.id} email={juror.email} name={juror.name} />
        </div>
      )}

      {editing && <EditJurorForm juror={juror} onDone={() => setEditing(false)} />}
    </li>
  );
}

function JurorSection({ id, title, jurors, empty }: { id: string; title: string; jurors: Juror[]; empty: string }) {
  return (
    <section className="admin-panel" aria-labelledby={id}>
      <p id={id} className="admin-eyebrow mb-3">
        {title} ({jurors.length})
      </p>
      {jurors.length === 0 ? (
        <p className="text-sm text-black/55">{empty}</p>
      ) : (
        <ul>
          {jurors.map((j) => (
            <JurorRow key={j.id} juror={j} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function JuryAdmin() {
  const jurors = useQuery(api.jury.adminOverview, {});

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Jury</p>
          <h1>Jury.</h1>
          <p>
            Create a profile for each person you want on the jury, then send them its private claim link. Claiming
            puts the profile on the site. Jurors evaluate sites in their voting week with the Evaluate button on each
            listing page; a site&apos;s jury score is the average of its evaluations.
          </p>
        </div>
        <Link href="/outreach" className="admin-button admin-button-secondary">
          Outreach
        </Link>
      </div>

      <div className="grid gap-6">
        <CreateJurorForm />

        {jurors === undefined ? (
          <p className="admin-eyebrow">Loading…</p>
        ) : (
          <>
            <JurorSection
              id="unclaimed-heading"
              title="Unclaimed"
              jurors={jurors.filter((j) => j.status === "unclaimed")}
              empty="Every profile has been claimed."
            />
            <JurorSection
              id="claimed-heading"
              title="Claimed"
              jurors={jurors.filter((j) => j.status === "claimed")}
              empty="Nobody has claimed a profile yet."
            />
          </>
        )}
      </div>
    </>
  );
}
