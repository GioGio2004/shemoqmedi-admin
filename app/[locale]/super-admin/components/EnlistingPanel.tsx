"use client";

// app/[locale]/super-admin/components/EnlistingPanel.tsx
// ─────────────────────────────────────────────────────────────────────────────
// 05 — ENLISTING: the seeded-venue directory manager.
// Backend: convex/venueDirectory.ts (super_admin gated server-side).
// RULED grammar: flat surfaces, hairlines, mono data, accent on primary
// actions and live states only.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { Loader2, Plus, X, ExternalLink, MapPinned } from "lucide-react";
import { LocationPickerMap } from "@/components/maps/LocationPickerMap";
import { ImageUploader } from "@/components/ImageUploader";

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = "cafe" | "restaurant" | "bar" | "hotel" | "other";

const CATEGORIES: Category[] = ["cafe", "restaurant", "bar", "hotel", "other"];

interface DirectoryVenue {
  _id: Id<"venues">;
  slug: string;
  name: string;
  category: string;
  address: string;
  phone?: string;
  orgId?: string;
  claimStatus: "unclaimed" | "claimed";
  menuMode?: "native" | "external";
  externalMenuUrl?: string;
  googleRating?: number;
  googleReviewCount?: number;
  isPublished: boolean;
  createdAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mirror of the server slugify in convex/venueDirectory.ts — preview only. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "venue"
  );
}

const hasGeorgian = (s: string) => /[Ⴀ-ჿ]/.test(s);

function errMsg(err: unknown): string {
  if (err instanceof ConvexError) {
    return typeof err.data === "string" ? err.data : "Operation failed.";
  }
  return err instanceof Error ? err.message : "Operation failed.";
}

// ─── Shared style atoms ───────────────────────────────────────────────────────

const inputCls =
  "w-full bg-v-bg border border-v-line rounded-v px-3 py-2.5 text-sm text-v-ink placeholder:text-v-faint outline-none focus:border-v-faint transition-colors";

const primaryBtnCls =
  "v-t-micro v-press inline-flex items-center justify-center gap-2 rounded-v bg-v-accent px-4 py-2.5 text-v-accent-ink disabled:opacity-40 disabled:cursor-not-allowed";

const ghostBtnCls =
  "v-t-micro v-press inline-flex items-center justify-center gap-2 rounded-v border border-v-line px-4 py-2.5 text-v-mut hover:text-v-ink hover:border-v-faint transition-colors";

// ─── Micro components ─────────────────────────────────────────────────────────

function Field({
  label,
  span2,
  children,
}: {
  label: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <label className="v-t-micro block text-v-faint">{label}</label>
      {children}
    </div>
  );
}

/** Flat RULED modal — bottom sheet at 375px, centered card on desktop. */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full flex-col rounded-v border border-v-line bg-v-bg-raise sm:max-w-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-v-line px-4 py-3">
          <p className="v-t-micro text-v-ink">{title}</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="v-press -mr-1 p-1 text-v-faint transition-colors hover:text-v-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** Publish switch — accent = live/published state. */
function PublishToggle({
  on,
  busy,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      disabled={busy}
      role="switch"
      aria-checked={on}
      aria-label={on ? "Published — click to unpublish" : "Unpublished — click to publish"}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-v transition-colors disabled:opacity-40 ${
        on ? "bg-v-accent" : "bg-v-line"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-[1px] bg-v-bg transition-transform ${
          on ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** Claim badge — UNCLAIMED gets the accent live-dot, CLAIMED goes quiet. */
function ClaimBadge({ status }: { status: "unclaimed" | "claimed" }) {
  if (status === "unclaimed") {
    return (
      <span className="v-t-micro inline-flex items-center gap-1.5 text-v-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-v-accent" aria-hidden />
        Unclaimed
      </span>
    );
  }
  return <span className="v-t-micro text-v-faint">Claimed</span>;
}

// ─── Venue form (seed + edit) ─────────────────────────────────────────────────

interface VenueFormState {
  name: string;
  latinName: string;
  category: Category;
  description: string;
  address: string;
  lat: string;
  lng: string;
  phone: string;
  externalMenuUrl: string;
  gbpPlaceId: string;
  coverImage: string;
  tags: string;
  publish: boolean;
  menuMode: "" | "native" | "external";
}

const EMPTY_FORM: VenueFormState = {
  name: "",
  latinName: "",
  category: "restaurant",
  description: "",
  address: "",
  lat: "",
  lng: "",
  phone: "",
  externalMenuUrl: "",
  gbpPlaceId: "",
  coverImage: "",
  tags: "",
  publish: true,
  menuMode: "",
};

function VenueForm({
  mode,
  initial,
  currentSlug,
  busy,
  onSubmit,
}: {
  mode: "seed" | "edit";
  initial: VenueFormState;
  currentSlug?: string;
  busy: boolean;
  onSubmit: (form: VenueFormState) => void;
}) {
  const [form, setForm] = useState<VenueFormState>(initial);

  const set = <K extends keyof VenueFormState>(key: K, value: VenueFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Live slug preview: latinName wins; in edit mode an empty latinName keeps
  // the existing slug (updateVenue only regenerates when latinName is set).
  const slugSource = form.latinName.trim() || (mode === "seed" ? form.name.trim() : "");
  const previewSlug = slugSource
    ? slugify(slugSource)
    : mode === "edit"
      ? (currentSlug ?? "")
      : "";
  const georgianWarning =
    hasGeorgian(form.name) && !form.latinName.trim() && mode === "seed";

  const canSubmit =
    form.name.trim().length > 0 && form.address.trim().length > 0 && !busy;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(form);
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <Field label="Name *">
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. კაფე ფესვები"
          className={inputCls}
        />
      </Field>

      <Field label="Latin name (drives the URL slug)">
        <input
          value={form.latinName}
          onChange={(e) => set("latinName", e.target.value)}
          placeholder="e.g. Cafe Pesvebi"
          className={inputCls}
        />
      </Field>

      {/* Live slug preview */}
      <div className="rounded-v border border-v-line bg-v-bg px-3 py-2.5 sm:col-span-2">
        <p className="v-t-micro text-v-faint">Slug preview</p>
        <p className="mt-1 break-all font-v-mono text-sm text-v-ink">
          /{previewSlug || "—"}
        </p>
        {georgianWarning && (
          <p className="v-t-micro mt-1.5 text-v-mut">
            Georgian name detected — add a latin name for a clean URL
          </p>
        )}
        {mode === "edit" && !form.latinName.trim() && (
          <p className="v-t-micro mt-1.5 text-v-faint">
            Slug regenerates only when a latin name is entered
          </p>
        )}
      </div>

      <Field label="Category *">
        <select
          value={form.category}
          onChange={(e) => set("category", e.target.value as Category)}
          className={`${inputCls} cursor-pointer`}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Phone">
        <input
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="+995 …"
          className={`${inputCls} font-v-mono`}
        />
      </Field>

      <Field label="Address *" span2>
        <input
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="Street, city"
          className={inputCls}
        />
      </Field>

      <Field label={mode === "edit" ? "Description (blank = keep current)" : "Description"} span2>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows={2}
          className={`${inputCls} resize-none`}
        />
      </Field>

      {/* Location — Places search (debounced, session-tokened), tap-to-place,
          drag-to-refine. Selecting a search result also autofills empty
          name/address fields and the Google Place ID. */}
      <div className="sm:col-span-2">
        <p className="v-t-micro mb-1.5 text-v-faint">
          Location — search, tap the map, or drag the pin
        </p>
        <div className="h-72 overflow-hidden rounded-v border border-v-line">
          <LocationPickerMap
            lat={Number.parseFloat(form.lat) || undefined}
            lng={Number.parseFloat(form.lng) || undefined}
            onChange={(lat, lng) => {
              set("lat", lat.toFixed(6));
              set("lng", lng.toFixed(6));
            }}
            onPlaceSelect={(p) => {
              set("lat", p.lat.toFixed(6));
              set("lng", p.lng.toFixed(6));
              if (p.placeId) set("gbpPlaceId", p.placeId);
              if (p.address && !form.address.trim()) set("address", p.address);
              if (p.name && !form.name.trim()) set("name", p.name);
              if (p.name && !form.latinName.trim() && !hasGeorgian(p.name))
                set("latinName", p.name);
            }}
          />
        </div>
        <p className="v-t-micro mt-1.5 font-v-mono tabular-nums text-v-mut">
          {form.lat && form.lng ? `${form.lat}, ${form.lng}` : "No location set"}
        </p>
      </div>

      <Field label="External menu URL">
        <input
          value={form.externalMenuUrl}
          onChange={(e) => set("externalMenuUrl", e.target.value)}
          placeholder="https://…"
          className={`${inputCls} font-v-mono`}
        />
      </Field>

      <Field label="Google Place ID">
        <input
          value={form.gbpPlaceId}
          onChange={(e) => set("gbpPlaceId", e.target.value)}
          placeholder="ChIJ…"
          className={`${inputCls} font-v-mono`}
        />
      </Field>

      <Field label="Cover image" span2>
        <div className="flex flex-col gap-2">
          <input
            value={form.coverImage}
            onChange={(e) => set("coverImage", e.target.value)}
            placeholder="https://… (or upload below)"
            className={`${inputCls} font-v-mono`}
          />
          <div className="flex items-start gap-3">
            <ImageUploader
              itemName={form.latinName.trim() || form.name.trim() || "venue-cover"}
              cafeName="directory"
              folder="/venue-covers"
              onSuccess={(r) => {
                if (r.url) set("coverImage", r.url);
              }}
            />
            {form.coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.coverImage}
                alt="Cover preview"
                className="h-16 w-24 rounded-v border border-v-line object-cover"
              />
            )}
          </div>
        </div>
      </Field>

      <Field label="Tags (comma-separated)">
        <input
          value={form.tags}
          onChange={(e) => set("tags", e.target.value)}
          placeholder="specialty coffee, brunch"
          className={inputCls}
        />
      </Field>

      {mode === "edit" && (
        <Field label="Menu mode">
          <select
            value={form.menuMode}
            onChange={(e) =>
              set("menuMode", e.target.value as VenueFormState["menuMode"])
            }
            className={`${inputCls} cursor-pointer`}
          >
            <option value="">— keep current —</option>
            <option value="native">native</option>
            <option value="external">external</option>
          </select>
        </Field>
      )}

      {mode === "seed" && (
        <div className="flex items-center gap-2.5 sm:col-span-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={form.publish}
            onClick={() => set("publish", !form.publish)}
            className={`v-press flex h-4 w-4 shrink-0 items-center justify-center rounded-v border transition-colors ${
              form.publish
                ? "border-v-accent bg-v-accent"
                : "border-v-line bg-v-bg"
            }`}
          >
            {form.publish && (
              <span className="h-1.5 w-1.5 rounded-[1px] bg-v-accent-ink" aria-hidden />
            )}
          </button>
          <span className="v-t-micro text-v-mut">
            Publish immediately (seeding is publishing)
          </span>
        </div>
      )}

      <div className="sm:col-span-2">
        <button type="submit" disabled={!canSubmit} className={`${primaryBtnCls} w-full`}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mode === "seed" ? "Seed venue" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function EnlistingPanel({ organizations }: { organizations: any[] }) {
  const venues = useQuery(api.venueDirectory.listDirectory, {});
  const seedVenue = useMutation(api.venueDirectory.seedVenue);
  const updateVenue = useMutation(api.venueDirectory.updateVenue);
  const claimVenue = useMutation(api.venueDirectory.claimVenue);
  const removeVenue = useMutation(api.venueDirectory.removeVenue);

  const [seedOpen, setSeedOpen] = useState(false);
  const [editing, setEditing] = useState<DirectoryVenue | null>(null);
  const [claiming, setClaiming] = useState<DirectoryVenue | null>(null);
  const [removing, setRemoving] = useState<DirectoryVenue | null>(null);
  const [claimOrgId, setClaimOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const isLoading = venues === undefined;
  const list: DirectoryVenue[] = (venues ?? []) as DirectoryVenue[];

  const stats = [
    { label: "Total", value: list.length },
    { label: "Unclaimed", value: list.filter((v) => v.claimStatus === "unclaimed").length },
    { label: "Claimed", value: list.filter((v) => v.claimStatus === "claimed").length },
    { label: "Published", value: list.filter((v) => v.isPublished).length },
  ];

  // ── Mutation handlers ──────────────────────────────────────────────────────

  const handleSeed = async (form: VenueFormState) => {
    setBusy(true);
    try {
      await seedVenue({
        name: form.name.trim(),
        latinName: form.latinName.trim() || undefined,
        category: form.category,
        description: form.description.trim() || undefined,
        address: form.address.trim(),
        lat: form.lat.trim() ? parseFloat(form.lat.trim()) : undefined,
        lng: form.lng.trim() ? parseFloat(form.lng.trim()) : undefined,
        phone: form.phone.trim() || undefined,
        externalMenuUrl: form.externalMenuUrl.trim() || undefined,
        gbpPlaceId: form.gbpPlaceId.trim() || undefined,
        coverImage: form.coverImage.trim() || undefined,
        tags: form.tags.trim()
          ? form.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : undefined,
        publish: form.publish,
      });
      toast.success(`Seeded "${form.name.trim()}" into the directory.`);
      setSeedOpen(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (form: VenueFormState) => {
    if (!editing) return;
    setBusy(true);
    try {
      await updateVenue({
        venueId: editing._id,
        name: form.name.trim() || undefined,
        latinName: form.latinName.trim() || undefined,
        category: form.category,
        // Optional fields: only send when filled — blank means "keep current"
        // (listDirectory does not return these, so we cannot pre-fill them).
        description: form.description.trim() || undefined,
        address: form.address.trim() || undefined,
        lat: form.lat.trim() ? parseFloat(form.lat.trim()) : undefined,
        lng: form.lng.trim() ? parseFloat(form.lng.trim()) : undefined,
        phone: form.phone.trim() || undefined,
        externalMenuUrl: form.externalMenuUrl.trim() || undefined,
        gbpPlaceId: form.gbpPlaceId.trim() || undefined,
        coverImage: form.coverImage.trim() || undefined,
        menuMode: form.menuMode || undefined,
      });
      toast.success(`Updated "${form.name.trim() || editing.name}".`);
      setEditing(null);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePublish = async (v: DirectoryVenue) => {
    setTogglingId(v._id);
    try {
      await updateVenue({ venueId: v._id, isPublished: !v.isPublished });
      toast.success(v.isPublished ? `Unpublished "${v.name}".` : `Published "${v.name}".`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setTogglingId(null);
    }
  };

  const handleClaim = async () => {
    if (!claiming || !claimOrgId.trim()) return;
    setBusy(true);
    try {
      await claimVenue({ venueId: claiming._id, orgId: claimOrgId.trim() });
      toast.success(`"${claiming.name}" claimed.`);
      setClaiming(null);
      setClaimOrgId("");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await removeVenue({ venueId: removing._id });
      toast.success(`"${removing.name}" removed from the directory.`);
      setRemoving(null);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  // ── Row actions (shared desktop/mobile) ────────────────────────────────────

  const RowActions = ({ v }: { v: DirectoryVenue }) => (
    <div className="flex items-center gap-3">
      <button
        onClick={() => setEditing(v)}
        className="v-t-micro v-press text-v-mut transition-colors hover:text-v-ink"
      >
        Edit
      </button>
      {v.claimStatus === "unclaimed" && (
        <button
          onClick={() => {
            setClaimOrgId("");
            setClaiming(v);
          }}
          className="v-t-micro v-press text-v-mut transition-colors hover:text-v-ink"
        >
          Claim
        </button>
      )}
      <button
        onClick={() => setRemoving(v)}
        className="v-t-micro v-press text-v-mut transition-colors hover:text-red-400"
      >
        Remove
      </button>
    </div>
  );

  const Rating = ({ v }: { v: DirectoryVenue }) =>
    v.googleRating !== undefined ? (
      <span className="font-v-mono text-xs tabular-nums text-v-mut">
        {v.googleRating.toFixed(1)}
        {v.googleReviewCount !== undefined && (
          <span className="text-v-faint"> ({v.googleReviewCount})</span>
        )}
      </span>
    ) : (
      <span className="text-v-faint">—</span>
    );

  const MenuMode = ({ v }: { v: DirectoryVenue }) =>
    v.menuMode ? (
      <span className="v-t-micro inline-flex items-center gap-1 text-v-mut">
        {v.menuMode}
        {v.menuMode === "external" && v.externalMenuUrl && (
          <a
            href={v.externalMenuUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open external menu"
            className="text-v-faint transition-colors hover:text-v-ink"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>
    ) : (
      <span className="text-v-faint">—</span>
    );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Stats — hairline grid, mono numbers */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-v border border-v-line bg-v-line sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-v-bg-raise p-4">
            <p className="v-t-micro text-v-faint">{s.label}</p>
            <p className="mt-1 font-v-mono text-2xl tabular-nums text-v-ink">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Seed venue — collapsible form */}
      <div className="rounded-v border border-v-line bg-v-bg-raise">
        <button
          onClick={() => setSeedOpen((o) => !o)}
          className="v-press flex w-full items-center justify-between px-4 py-3"
        >
          <span className="v-t-micro flex items-center gap-2 text-v-ink">
            <Plus className="h-3.5 w-3.5" />
            Seed venue
          </span>
          <span className="v-t-micro text-v-faint">{seedOpen ? "Close" : "Open"}</span>
        </button>
        {seedOpen && (
          <div className="border-t border-v-line p-4">
            <VenueForm
              mode="seed"
              initial={EMPTY_FORM}
              busy={busy}
              onSubmit={handleSeed}
            />
          </div>
        )}
      </div>

      {/* Directory */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-v-faint" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-v border border-dashed border-v-line py-16 text-center">
          <MapPinned className="mb-3 h-8 w-8 text-v-faint" />
          <p className="text-sm text-v-ink">Directory is empty</p>
          <p className="mt-1 text-xs text-v-mut">
            Seed the first venue with the form above.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-v border border-v-line bg-v-bg-raise md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-v-line">
                    {["Venue", "Slug", "Category", "Claim", "Rating", "Live", "Menu", ""].map(
                      (h, i) => (
                        <th
                          key={i}
                          className="v-t-micro whitespace-nowrap px-4 py-2.5 text-left font-normal text-v-faint"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-v-line">
                  {list.map((v) => (
                    <tr key={v._id} className="transition-colors hover:bg-v-bg">
                      <td className="max-w-[220px] px-4 py-3">
                        <p className="truncate text-v-ink">{v.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-v-faint">
                          {v.address}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-v-mono text-xs text-v-mut">/{v.slug}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="v-t-micro text-v-mut">{v.category}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <ClaimBadge status={v.claimStatus} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Rating v={v} />
                      </td>
                      <td className="px-4 py-3">
                        <PublishToggle
                          on={v.isPublished}
                          busy={togglingId === v._id}
                          onToggle={() => handleTogglePublish(v)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <MenuMode v={v} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <RowActions v={v} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {list.map((v) => (
              <div key={v._id} className="rounded-v border border-v-line bg-v-bg-raise p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-v-ink">{v.name}</p>
                    <p className="mt-0.5 truncate font-v-mono text-xs text-v-mut">
                      /{v.slug}
                    </p>
                  </div>
                  <PublishToggle
                    on={v.isPublished}
                    busy={togglingId === v._id}
                    onToggle={() => handleTogglePublish(v)}
                  />
                </div>

                <p className="mt-2 truncate text-[11px] text-v-faint">{v.address}</p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <ClaimBadge status={v.claimStatus} />
                  <span className="v-t-micro text-v-mut">{v.category}</span>
                  <Rating v={v} />
                  <MenuMode v={v} />
                </div>

                <div className="v-hairline my-3" aria-hidden />

                <RowActions v={v} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Edit dialog — reuses the venue form ── */}
      {editing && (
        <Modal title={`Edit — ${editing.name}`} onClose={() => setEditing(null)}>
          <VenueForm
            key={editing._id}
            mode="edit"
            currentSlug={editing.slug}
            initial={{
              ...EMPTY_FORM,
              name: editing.name,
              category: (CATEGORIES as string[]).includes(editing.category)
                ? (editing.category as Category)
                : "other",
              address: editing.address,
              phone: editing.phone ?? "",
              externalMenuUrl: editing.externalMenuUrl ?? "",
              menuMode: editing.menuMode ?? "",
            }}
            busy={busy}
            onSubmit={handleUpdate}
          />
        </Modal>
      )}

      {/* ── Claim dialog ── */}
      {claiming && (
        <Modal title={`Claim — ${claiming.name}`} onClose={() => setClaiming(null)}>
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-v-mut">
              Link <span className="text-v-ink">{claiming.name}</span> to a Clerk
              organization. Verify the owner out-of-band first (call the phone
              number on their Google profile).
            </p>

            {organizations.length > 0 && (
              <Field label="Organization">
                <select
                  value={
                    organizations.some((o: any) => o.clerkId === claimOrgId)
                      ? claimOrgId
                      : ""
                  }
                  onChange={(e) => setClaimOrgId(e.target.value)}
                  className={`${inputCls} cursor-pointer`}
                >
                  <option value="">— Select organization —</option>
                  {organizations.map((o: any) => (
                    <option key={o._id} value={o.clerkId}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Clerk org id">
              <input
                value={claimOrgId}
                onChange={(e) => setClaimOrgId(e.target.value)}
                placeholder="org_…"
                className={`${inputCls} font-v-mono`}
              />
            </Field>

            <div className="flex gap-2">
              <button onClick={() => setClaiming(null)} className={`${ghostBtnCls} flex-1`}>
                Cancel
              </button>
              <button
                onClick={handleClaim}
                disabled={!claimOrgId.trim() || busy}
                className={`${primaryBtnCls} flex-1`}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Claim venue
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Remove confirm dialog ── */}
      {removing && (
        <Modal title="Remove venue" onClose={() => setRemoving(null)}>
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-v-mut">
              This permanently removes{" "}
              <span className="text-v-ink">{removing.name}</span>{" "}
              <span className="font-v-mono">/{removing.slug}</span> from the
              directory. Claimed venues are protected server-side — unpublish
              those instead.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setRemoving(null)} className={`${ghostBtnCls} flex-1`}>
                Cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={busy}
                className="v-t-micro v-press inline-flex flex-1 items-center justify-center gap-2 rounded-v border border-red-500/40 px-4 py-2.5 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Remove
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
