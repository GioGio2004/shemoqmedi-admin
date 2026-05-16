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
    <form onSubmit={handleSubmit} className="p-5 bg-white/[0.02] border border-white/10 rounded-2xl space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Plus className="w-4 h-4 text-white" />
        <p className="text-sm font-semibold text-white">Provision New Tag</p>
      </div>

      {/* UUID row */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500 mb-1.5">Chip UUID</p>
        <div className="flex gap-2">
          <code className="flex-1 text-[11px] font-mono text-orange-400 bg-orange-500/5 border border-orange-500/20 rounded-lg px-3 py-2.5 truncate">
            {uuid}
          </code>
          <button type="button" onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-zinc-400 hover:text-white text-xs transition-colors shrink-0">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
          <button type="button" onClick={() => setUuid(generateUUID())}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-zinc-400 hover:text-white text-xs transition-colors shrink-0">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Table name */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500 mb-1.5">Table / Location Name</p>
        <input
          value={tableName}
          onChange={e => setTableName(e.target.value)}
          placeholder="e.g. Table 7, Bar Seat 2, Patio-A (optional)"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/25"
        />
      </div>

      {/* QR preview */}
      <div className="flex items-center gap-4 p-3 bg-white/[0.02] border border-white/10 rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrUrl} alt="UUID QR" className="w-[72px] h-[72px] rounded-md bg-white p-1 shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500 mb-1">Write to NTAG216</p>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Scan this QR with your NFC writer app, or copy the UUID above and write it directly to the chip.
          </p>
        </div>
      </div>

      <button type="submit" disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-zinc-100 transition-colors disabled:opacity-50">
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
    <div className={cn("border rounded-xl overflow-hidden transition-all", tag.isActive ? "border-white/10 bg-[#09090b]" : "border-red-500/20 bg-red-950/10")}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status dot */}
        <div className={cn("w-2 h-2 rounded-full shrink-0", tag.isActive ? "bg-emerald-500" : "bg-red-500")} />

        {/* UUID */}
        <code className="text-[11px] font-mono text-orange-400 min-w-0 truncate flex-1">
          {tag.volooTagsUUID}
        </code>

        {/* Table label */}
        <span className="text-xs text-zinc-400 shrink-0 hidden sm:block">
          {tag.tableName ?? <span className="text-zinc-600 italic">unassigned</span>}
        </span>

        {/* Org */}
        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 hidden md:block",
          org ? "bg-white/5 border-white/10 text-white" : "bg-zinc-900 border-white/5 text-zinc-600")}>
          {org?.name ?? "—"}
        </span>

        {/* Tap count */}
        <span className="text-xs text-zinc-500 shrink-0">{tag.tapCount ?? 0} taps</span>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={handleToggleActive} title={tag.isActive ? "Deactivate" : "Activate"}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors">
            {tag.isActive ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setEditing(v => !v)} title="Edit"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors">
            {editing ? <X className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
          </button>
          <button onClick={handleDelete} title="Delete"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 flex flex-col sm:flex-row gap-2">
          <input value={tableName} onChange={e => setTableName(e.target.value)} placeholder="Table name…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/25" />
          <select value={orgId} onChange={e => setOrgId(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/25">
            <option value="">— No org assigned —</option>
            {organizations.map(o => <option key={o._id} value={o.clerkId}>{o.name}</option>)}
          </select>
          <button onClick={handleSave} disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-sm font-semibold hover:bg-zinc-100 transition-colors disabled:opacity-50 shrink-0">
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
    <div className="space-y-8 max-w-5xl pb-20 text-zinc-50">
      {/* Header */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex items-center gap-2 mb-1">
          <Nfc className="w-4 h-4 text-white" />
          <h1 className="text-3xl font-medium tracking-tight text-white">NFC Fleet</h1>
        </div>
        <p className="text-sm text-zinc-400">
          Provision, assign, and manage physical NTAG216 chips across all cafe locations.
          <span className="ml-1 text-orange-400 font-medium">Super Admin only.</span>
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
            <div key={label} className="p-4 bg-[#09090b] border border-white/10 rounded-xl">
              <Icon className="w-3.5 h-3.5 text-zinc-500 mb-2" />
              <p className="text-2xl font-medium text-white">{value}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Provision toggle */}
      <div>
        <button onClick={() => setShowProvision(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors mb-4">
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search UUID or table name…"
            className="w-full pl-9 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/25" />
        </div>
        <select value={filterOrg ?? ""} onChange={e => setFilterOrg(e.target.value || undefined)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-white/25">
          <option value="">All organizations</option>
          {organizations.map(o => <option key={o._id} value={o.clerkId}>{o.name}</option>)}
        </select>
      </div>

      {/* Tag list */}
      {tags === undefined ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3 border border-dashed border-white/10 rounded-2xl">
          <Nfc className="w-10 h-10 text-zinc-700" />
          <p className="text-zinc-400 font-medium">{search ? "No tags match your search" : "No tags provisioned yet"}</p>
          <p className="text-sm text-zinc-600">Click &ldquo;Provision a new tag&rdquo; above to register your first NFC chip.</p>
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
