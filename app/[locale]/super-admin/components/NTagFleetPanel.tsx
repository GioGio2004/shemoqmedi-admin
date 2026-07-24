"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Nfc, Plus, RefreshCw, Search, Copy, Check,
  Trash2, Edit3, X, Loader2, Wifi, WifiOff,
  ChevronDown, ChevronUp, ScanLine, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── SHARED STYLE ATOMS ──────────────────────────────────────────────────────
const inputCls =
  "w-full bg-v-bg border border-v-line rounded-v px-3 py-2.5 text-sm text-v-ink placeholder:text-v-faint outline-none focus:border-v-faint transition-colors";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function generateUUID() {
  return `shemo-${crypto.randomUUID()}`;
}

// ─── PROVISION FORM ───────────────────────────────────────────────────────────
function ProvisionForm({
  organizations,
  baseDomain,
  onSuccess,
}: {
  organizations: any[];
  baseDomain: string;
  onSuccess: () => void;
}) {
  const [uuid, setUuid] = useState(generateUUID());
  const [tableName, setTableName] = useState("");
  const [seatNumber, setSeatNumber] = useState("");
  const [orgId, setOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const provisionTag = useMutation(api.volootagsAdmin.provisionPhysicalTag);

  const handleCopy = () => {
    navigator.clipboard.writeText(uuid);
    setCopied(true);
    toast.success("UUID copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uuid.trim()) return toast.error("Generate a UUID first");
    setBusy(true);
    try {
      await provisionTag({
        volooTagsUUID: uuid.trim(),
        tableName: tableName.trim() || undefined,
        seatNumber: seatNumber.trim() ? parseInt(seatNumber.trim()) : undefined,
        orgId: orgId || undefined,
      });
      toast.success("Tag provisioned — write this UUID to the NFC chip.");
      setUuid(generateUUID());
      setTableName("");
      setSeatNumber("");
      onSuccess();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Provisioning failed");
    } finally {
      setBusy(false);
    }
  };

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&format=png&margin=8&data=${encodeURIComponent(uuid)}`;
  const fullUrl = `${baseDomain.replace(/\/$/, "")}/t/${uuid}`;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-v border border-v-line bg-v-bg p-4"
    >
      <p className="v-t-micro text-v-faint">Provision new chip</p>

      {/* UUID row */}
      <div>
        <p className="v-t-micro mb-1.5 text-v-faint">Chip UUID</p>
        <div className="flex gap-2">
          <code className="flex-1 truncate rounded-v border border-v-line bg-v-bg-raise px-3 py-2.5 font-v-mono text-[11px] text-v-ink">
            {uuid}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy"
            className="v-press flex shrink-0 items-center rounded-v border border-v-line px-3 py-2 text-v-mut transition-colors hover:border-v-faint hover:text-v-ink"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-v-accent" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setUuid(generateUUID())}
            title="Regenerate"
            className="v-press flex shrink-0 items-center rounded-v border border-v-line px-3 py-2 text-v-mut transition-colors hover:border-v-faint hover:text-v-ink"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Table + org row */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="v-t-micro mb-1.5 text-v-faint">Table / Location</p>
          <input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="e.g. Table 7, Bar"
            className={inputCls}
          />
        </div>
        <div>
          <p className="v-t-micro mb-1.5 text-v-faint">Seat Number</p>
          <input
            type="number"
            value={seatNumber}
            onChange={(e) => setSeatNumber(e.target.value)}
            placeholder="e.g. 7"
            className={`${inputCls} font-v-mono`}
          />
        </div>
        <div>
          <p className="v-t-micro mb-1.5 text-v-faint">Assign to Org</p>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className={`${inputCls} cursor-pointer`}
          >
            <option value="">— Unassigned —</option>
            {organizations.map((o: any) => (
              <option key={o._id} value={o.clerkId}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* QR + URL preview */}
      <div className="flex items-center gap-4 rounded-v border border-v-line bg-v-bg-raise p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrUrl}
          alt="NFC UUID QR"
          className="h-[64px] w-[64px] shrink-0 rounded-v bg-white p-1"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="v-t-micro text-v-faint">Tap URL</p>
          <code className="block truncate rounded-v border border-v-line bg-v-bg px-2 py-1 font-v-mono text-[10px] text-v-mut">
            {fullUrl}
          </code>
          <div className="flex gap-3">
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="v-t-micro flex items-center gap-1 text-v-mut transition-colors hover:text-v-ink"
            >
              <ExternalLink className="h-3 w-3" /> Test URL
            </a>
            <button
              type="button"
              onClick={() => {
                const qrBig = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=png&margin=12&data=${encodeURIComponent(fullUrl)}`;
                window.open(qrBig, "_blank");
              }}
              className="v-t-micro flex items-center gap-1 text-v-mut transition-colors hover:text-v-ink"
            >
              <ScanLine className="h-3 w-3" /> Full QR
            </button>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="v-t-micro v-press flex w-full items-center justify-center gap-2 rounded-v bg-v-accent py-3 text-v-accent-ink disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Nfc className="h-4 w-4" />
        )}
        {busy ? "Provisioning…" : "Register NFC Tag"}
      </button>
    </form>
  );
}

// ─── TAG ROW ─────────────────────────────────────────────────────────────────
function TagRow({
  tag,
  organizations,
}: {
  tag: any;
  organizations: any[];
}) {
  const [editing, setEditing] = useState(false);
  const [tableName, setTableName] = useState(tag.tableName ?? "");
  const [seatNumber, setSeatNumber] = useState(tag.seatNumber?.toString() ?? "");
  const [orgId, setOrgId] = useState(tag.orgId ?? "");
  const [busy, setBusy] = useState(false);

  const updateTag = useMutation(api.volootagsAdmin.updatePhysicalTag);
  const deleteTag = useMutation(api.volootagsAdmin.deletePhysicalTag);

  const org = organizations.find((o: any) => o.clerkId === tag.orgId);

  const handleSave = async () => {
    setBusy(true);
    try {
      await updateTag({
        tagId: tag._id as Id<"physicalTags">,
        tableName: tableName || undefined,
        seatNumber: seatNumber.trim() ? parseInt(seatNumber.trim()) : undefined,
        orgId: orgId || undefined,
      });
      toast.success("Tag updated");
      setEditing(false);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete tag "${tag.volooTagsUUID}"? The chip will stop working.`)) return;
    try {
      await deleteTag({ tagId: tag._id as Id<"physicalTags"> });
      toast.success("Tag deleted");
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Delete failed");
    }
  };

  const handleToggleActive = async () => {
    try {
      await updateTag({ tagId: tag._id as Id<"physicalTags">, isActive: !tag.isActive });
      toast.success(tag.isActive ? "Tag deactivated" : "Tag activated");
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed");
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-v border transition-colors",
        tag.isActive
          ? "border-v-line bg-v-bg-raise"
          : "border-red-500/30 bg-v-bg-raise",
      )}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Live-state dot: accent = live in the field */}
        <div
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            tag.isActive ? "bg-v-accent" : "bg-red-400",
          )}
        />

        <code className="min-w-0 flex-1 truncate font-v-mono text-[11px] text-v-mut">
          {tag.volooTagsUUID}
        </code>

        <span className="hidden shrink-0 text-xs text-v-mut sm:block">
          {tag.tableName ?? (
            <span className="italic text-v-faint">no table</span>
          )}
          {tag.seatNumber !== undefined && ` (Seat ${tag.seatNumber})`}
        </span>

        <span
          className={cn(
            "v-t-micro hidden shrink-0 rounded-v border px-2 py-0.5 md:block",
            org
              ? "border-v-line text-v-ink"
              : "border-v-line text-v-faint",
          )}
        >
          {org?.name ?? "unassigned"}
        </span>

        <span className="shrink-0 font-v-mono text-xs tabular-nums text-v-mut">
          {tag.tapCount ?? 0} taps
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={handleToggleActive}
            title={tag.isActive ? "Deactivate" : "Activate"}
            className="v-press rounded-v p-1.5 text-v-faint transition-colors hover:bg-v-bg hover:text-v-ink"
          >
            {tag.isActive ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            title="Edit"
            className="v-press rounded-v p-1.5 text-v-faint transition-colors hover:bg-v-bg hover:text-v-ink"
          >
            {editing ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Edit3 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={handleDelete}
            title="Delete"
            className="v-press rounded-v p-1.5 text-v-faint transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Edit row */}
      {editing && (
        <div className="flex flex-col gap-2 border-t border-v-line px-4 pb-4 pt-3 sm:flex-row">
          <input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="Table name…"
            className={`${inputCls} flex-1 py-2`}
          />
          <input
            type="number"
            value={seatNumber}
            onChange={(e) => setSeatNumber(e.target.value)}
            placeholder="Seat number…"
            className={`${inputCls} py-2 font-v-mono sm:w-32`}
          />
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className={`${inputCls} flex-1 cursor-pointer py-2`}
          >
            <option value="">— Unassigned —</option>
            {organizations.map((o: any) => (
              <option key={o._id} value={o.clerkId}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={busy}
            className="v-t-micro v-press flex shrink-0 items-center justify-center gap-2 rounded-v bg-v-accent px-4 py-2 text-v-accent-ink disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export function NTagFleetPanel({
  organizations,
}: {
  organizations: any[];
}) {
  const [search, setSearch] = useState("");
  const [filterOrg, setFilterOrg] = useState<string | undefined>(undefined);
  const [showProvision, setShowProvision] = useState(false);
  const [tick, setTick] = useState(0); // force re-render after provision
  const [baseDomain, setBaseDomain] = useState("https://shemoqmedi.space");

  // Load saved domain on mount
  useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("shemo_ntag_domain");
      if (saved) setBaseDomain(saved);
    }
  });

  const handleDomainChange = (val: string) => {
    setBaseDomain(val);
    if (typeof window !== "undefined") {
      localStorage.setItem("shemo_ntag_domain", val);
    }
  };

  const tags = useQuery(api.volootagsAdmin.getAllPhysicalTags, {
    orgId: filterOrg,
  });
  const stats = useQuery(api.volootagsAdmin.getPhysicalTagStats, {});

  const filtered = (tags ?? []).filter(
    (t: any) =>
      t.volooTagsUUID.includes(search) ||
      (t.tableName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const STATS = stats
    ? [
        { label: "Total chips", value: stats.totalTags },
        { label: "Active", value: stats.activeTags },
        { label: "Total taps", value: stats.totalTaps },
        { label: "Unassigned", value: stats.unassignedTags },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Stats — hairline grid, mono numbers */}
      {stats && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-v border border-v-line bg-v-line sm:grid-cols-4">
          {STATS.map(({ label, value }) => (
            <div key={label} className="bg-v-bg-raise p-4">
              <p className="v-t-micro text-v-faint">{label}</p>
              <p className="mt-1 font-v-mono text-2xl tabular-nums text-v-ink">
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Provision toggle & Domain config */}
      <div className="rounded-v border border-v-line bg-v-bg-raise p-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <button
            onClick={() => setShowProvision((v) => !v)}
            className="v-t-micro v-press flex items-center gap-2 text-v-mut transition-colors hover:text-v-ink"
          >
            {showProvision ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            <Plus className="h-4 w-4" />
            {showProvision ? "Hide provisioning form" : "Provision a new chip"}
          </button>

          <div className="flex items-center gap-2">
            <span className="v-t-micro shrink-0 text-v-faint">Tap Domain</span>
            <input
              value={baseDomain}
              onChange={(e) => handleDomainChange(e.target.value)}
              placeholder="e.g. https://ngrok.app"
              className="w-full min-w-0 rounded-v border border-v-line bg-v-bg px-3 py-1.5 font-v-mono text-xs text-v-ink outline-none transition-colors placeholder:text-v-faint focus:border-v-faint sm:w-[200px]"
            />
          </div>
        </div>

        {showProvision && (
          <div className="mt-4 border-t border-v-line pt-4">
            <ProvisionForm
              organizations={organizations}
              baseDomain={baseDomain}
              onSuccess={() => {
                setTick((t) => t + 1);
                setShowProvision(false);
              }}
            />
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-v-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search UUID or table name…"
            className={`${inputCls} pl-9`}
          />
        </div>
        <select
          value={filterOrg ?? ""}
          onChange={(e) => setFilterOrg(e.target.value || undefined)}
          className={`${inputCls} cursor-pointer sm:w-auto`}
        >
          <option value="">All organizations</option>
          {organizations.map((o: any) => (
            <option key={o._id} value={o.clerkId}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tag list */}
      {tags === undefined ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-v-faint" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-v border border-dashed border-v-line py-16 text-center">
          <Nfc className="h-9 w-9 text-v-faint" />
          <p className="text-sm text-v-ink">
            {search ? "No tags match your search" : "No chips provisioned yet"}
          </p>
          <p className="text-xs text-v-mut">
            Click &ldquo;Provision a new chip&rdquo; above to register your
            first NTAG216.
          </p>
        </div>
      ) : (
        <div key={tick} className="space-y-2">
          {filtered.map((tag: any) => (
            <TagRow
              key={tag._id}
              tag={tag}
              organizations={organizations}
            />
          ))}
        </div>
      )}
    </div>
  );
}
