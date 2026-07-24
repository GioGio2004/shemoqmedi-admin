"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Nfc, Plus, RefreshCw, Search, Copy, Check,
  Trash2, Edit3, X, Loader2, Wifi, WifiOff,
  Tag, Activity, AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function generateUUID() {
  return `shemo-${crypto.randomUUID()}`;
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── PROVISION FORM ───────────────────────────────────────────────────────────
function ProvisionForm({ orgId, onSuccess }: { orgId?: string; onSuccess: () => void }) {
  const [uuid, setUuid] = useState(generateUUID());
  const [tableName, setTableName] = useState("");
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
      await provisionTag({ volooTagsUUID: uuid.trim(), tableName: tableName.trim() || undefined, orgId });
      toast.success("Tag provisioned! Write this UUID to the NFC chip.");
      setUuid(generateUUID());
      setTableName("");
      onSuccess();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Provisioning failed");
    } finally {
      setBusy(false);
    }
  };

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&format=png&margin=8&data=${encodeURIComponent(uuid)}`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-v border border-v-line bg-v-bg-raise p-5">
      <div className="mb-1 flex items-center gap-2">
        <Plus className="h-4 w-4 text-v-mut" />
        <p className="text-sm font-medium text-v-ink">Provision New Tag</p>
      </div>

      {/* UUID row */}
      <div>
        <p className="v-t-micro mb-1.5 text-v-faint">Chip UUID</p>
        <div className="flex gap-2">
          <code className="flex-1 truncate rounded-v border border-v-line bg-v-bg px-3 py-2.5 font-v-mono text-[11px] text-v-ink">
            {uuid}
          </code>
          <button type="button" onClick={handleCopy}
            className="flex shrink-0 items-center gap-1.5 rounded-v border border-v-line px-3 py-2 text-xs text-v-mut transition-colors hover:text-v-ink">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
          <button type="button" onClick={() => setUuid(generateUUID())}
            className="flex shrink-0 items-center gap-1.5 rounded-v border border-v-line px-3 py-2 text-xs text-v-mut transition-colors hover:text-v-ink">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Table name */}
      <div>
        <p className="v-t-micro mb-1.5 text-v-faint">Table / Location Name</p>
        <input
          value={tableName}
          onChange={e => setTableName(e.target.value)}
          placeholder="e.g. Table 7, Bar Seat 2, Patio-A (optional)"
          className="w-full rounded-v border border-v-line bg-white/[0.03] px-3 py-2.5 text-sm text-v-ink outline-none placeholder:text-v-faint focus:border-v-accent"
        />
      </div>

      {/* QR preview */}
      <div className="flex items-center gap-4 rounded-v border border-v-line bg-white/[0.02] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrUrl} alt="UUID QR" className="h-[72px] w-[72px] shrink-0 rounded-v bg-white p-1" />
        <div className="min-w-0">
          <p className="v-t-micro mb-1 text-v-faint">Write to NTAG216</p>
          <p className="text-xs leading-relaxed text-v-mut">
            Scan this QR with your NFC writer app, or copy the UUID above and write it directly to the chip.
          </p>
        </div>
      </div>

      <button type="submit" disabled={busy}
        className="v-press flex w-full items-center justify-center gap-2 rounded-v bg-v-accent py-3 text-sm font-semibold text-v-accent-ink transition-[filter] hover:brightness-95 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Nfc className="w-4 h-4" />}
        {busy ? "Provisioning…" : "Register Tag"}
      </button>
    </form>
  );
}

// ─── TAG ROW ─────────────────────────────────────────────────────────────────
function TagRow({ tag, organizations }: { tag: any; organizations: any[] }) {
  const [editing, setEditing] = useState(false);
  const [tableName, setTableName] = useState(tag.tableName ?? "");
  const [orgId, setOrgId] = useState(tag.orgId ?? "");
  const [busy, setBusy] = useState(false);

  const updateTag = useMutation(api.volootagsAdmin.updatePhysicalTag);
  const deleteTag = useMutation(api.volootagsAdmin.deletePhysicalTag);

  const org = organizations.find(o => o.clerkId === tag.orgId);

  const handleSave = async () => {
    setBusy(true);
    try {
      await updateTag({ tagId: tag._id, tableName: tableName || undefined, orgId: orgId || undefined });
      toast.success("Tag updated");
      setEditing(false);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Update failed");
    } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this tag record? The physical chip will stop working.")) return;
    try {
      await deleteTag({ tagId: tag._id });
      toast.success("Tag deleted");
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Delete failed");
    }
  };

  const handleToggleActive = async () => {
    try {
      await updateTag({ tagId: tag._id, isActive: !tag.isActive });
      toast.success(tag.isActive ? "Tag deactivated" : "Tag activated");
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed");
    }
  };

  return (
    <div className={cn("overflow-hidden rounded-v border transition-all", tag.isActive ? "border-v-line bg-v-bg-raise" : "border-red-400/25 bg-red-500/[0.04]")}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status dot */}
        <div className={cn("h-2 w-2 shrink-0 rounded-full", tag.isActive ? "bg-v-accent" : "bg-red-400")} />

        {/* UUID */}
        <code className="min-w-0 flex-1 truncate font-v-mono text-[11px] text-v-mut">
          {tag.volooTagsUUID}
        </code>

        {/* Table label */}
        <span className="hidden shrink-0 text-xs text-v-mut sm:block">
          {tag.tableName ?? <span className="italic text-v-faint">unassigned</span>}
        </span>

        {/* Org */}
        <span className={cn("v-t-micro hidden shrink-0 rounded-v border px-2 py-0.5 md:block",
          org ? "border-v-line text-v-ink" : "border-v-line text-v-faint")}>
          {org?.name ?? "—"}
        </span>

        {/* Tap count */}
        <span className="shrink-0 text-xs tabular-nums text-v-faint">{tag.tapCount ?? 0} taps</span>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={handleToggleActive} title={tag.isActive ? "Deactivate" : "Activate"}
            className="rounded-v p-1.5 text-v-faint transition-colors hover:bg-white/[0.04] hover:text-v-ink">
            {tag.isActive ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setEditing(v => !v)} title="Edit"
            className="rounded-v p-1.5 text-v-faint transition-colors hover:bg-white/[0.04] hover:text-v-ink">
            {editing ? <X className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
          </button>
          <button onClick={handleDelete} title="Delete"
            className="rounded-v p-1.5 text-v-faint transition-colors hover:bg-red-400/10 hover:text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="flex flex-col gap-2 border-t border-v-line px-4 pb-4 pt-3 sm:flex-row">
          <input value={tableName} onChange={e => setTableName(e.target.value)} placeholder="Table name…"
            className="min-w-0 flex-1 rounded-v border border-v-line bg-white/[0.03] px-3 py-2 text-sm text-v-ink outline-none placeholder:text-v-faint focus:border-v-accent" />
          <select value={orgId} onChange={e => setOrgId(e.target.value)}
            className="min-w-0 flex-1 rounded-v border border-v-line bg-white/[0.03] px-3 py-2 text-sm text-v-ink outline-none focus:border-v-accent [color-scheme:dark]">
            <option value="">— No org assigned —</option>
            {organizations.map(o => <option key={o._id} value={o.clerkId}>{o.name}</option>)}
          </select>
          <button onClick={handleSave} disabled={busy}
            className="v-press flex shrink-0 items-center gap-2 rounded-v bg-v-accent px-4 py-2 text-sm font-semibold text-v-accent-ink transition-[filter] hover:brightness-95 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function FleetPage() {
  const { organization } = useOrganization();
  const [search, setSearch] = useState("");
  const [filterOrg, setFilterOrg] = useState<string | undefined>(undefined);
  const [showProvision, setShowProvision] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const tags = useQuery(api.volootagsAdmin.getAllPhysicalTags, { orgId: filterOrg });
  const stats = useQuery(api.volootagsAdmin.getPhysicalTagStats, {});
  const orgsData = useQuery(api.organizations.getAllOrganizationsWithMembers, {});
  const organizations = (orgsData ?? []) as any[];

  const filtered = (tags ?? []).filter(t =>
    t.volooTagsUUID.includes(search) ||
    (t.tableName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-5xl space-y-8 pb-20 text-v-ink">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex items-center gap-2 mb-1">
          <Nfc className="h-4 w-4 text-v-mut" />
          <h1 className="font-v-display text-2xl font-medium tracking-tight text-v-ink sm:text-3xl">NFC Fleet</h1>
        </div>
        <p className="text-sm text-v-mut">
          Provision, assign, and manage physical NTAG216 chips across all cafe locations.
          <span className="ml-1 font-medium text-v-ink">Super Admin only.</span>
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Tags", value: stats.totalTags, icon: Tag },
            { label: "Active", value: stats.activeTags, icon: Wifi },
            { label: "Total Taps", value: stats.totalTaps, icon: Activity },
            { label: "Unassigned", value: stats.unassignedTags, icon: AlertTriangle },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-v border border-v-line bg-v-bg-raise p-4">
              <Icon className="mb-2 h-3.5 w-3.5 text-v-faint" />
              <p className="font-v-display text-2xl font-medium tabular-nums text-v-ink">{value}</p>
              <p className="v-t-micro mt-0.5 text-v-faint">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Provision toggle */}
      <div>
        <button onClick={() => setShowProvision(v => !v)}
          className="mb-4 flex items-center gap-2 text-sm font-medium text-v-mut transition-colors hover:text-v-ink">
          {showProvision ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {showProvision ? "Hide" : "Provision a new tag"}
        </button>
        {showProvision && (
          <ProvisionForm orgId={filterOrg} onSuccess={() => setRefreshKey(k => k + 1)} />
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-v-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search UUID or table name…"
            className="w-full rounded-v border border-v-line bg-white/[0.03] py-2.5 pl-9 pr-3 text-sm text-v-ink outline-none placeholder:text-v-faint focus:border-v-accent" />
        </div>
        <select value={filterOrg ?? ""} onChange={e => setFilterOrg(e.target.value || undefined)}
          className="rounded-v border border-v-line bg-white/[0.03] px-3 py-2.5 text-sm text-v-ink outline-none focus:border-v-accent [color-scheme:dark]">
          <option value="">All organizations</option>
          {organizations.map(o => <option key={o._id} value={o.clerkId}>{o.name}</option>)}
        </select>
      </div>

      {/* Tag list */}
      {tags === undefined ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-v-faint" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-v border border-dashed border-v-line py-20 text-center">
          <Nfc className="h-10 w-10 text-v-faint" />
          <p className="font-medium text-v-mut">{search ? "No tags match your search" : "No tags provisioned yet"}</p>
          <p className="text-sm text-v-faint">Click &ldquo;Provision a new tag&rdquo; above to register your first NFC chip.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(tag => (
            <TagRow key={`${tag._id}-${refreshKey}`} tag={tag} organizations={organizations} />
          ))}
        </div>
      )}
    </div>
  );
}
