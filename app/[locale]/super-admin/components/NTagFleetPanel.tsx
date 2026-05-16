"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Nfc, Plus, RefreshCw, Search, Copy, Check,
  Trash2, Edit3, X, Loader2, Wifi, WifiOff,
  Tag, Activity, AlertTriangle, ChevronDown,
  ChevronUp, ScanLine, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function generateUUID() {
  return `shemo-${crypto.randomUUID()}`;
}

function timeAgo(ts: number) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(d / 3600000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
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
        orgId: orgId || undefined,
      });
      toast.success("Tag provisioned — write this UUID to the NFC chip.");
      setUuid(generateUUID());
      setTableName("");
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
      className="p-5 bg-white/[0.02] border border-white/10 rounded-2xl space-y-4"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
        Provision new chip
      </p>

      {/* UUID row */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-600 mb-1.5">
          Chip UUID
        </p>
        <div className="flex gap-2">
          <code className="flex-1 text-[11px] font-mono text-white bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 truncate">
            {uuid}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-zinc-400 hover:text-white text-xs transition-colors shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setUuid(generateUUID())}
            title="Regenerate"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-zinc-400 hover:text-white text-xs transition-colors shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Table + org row */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-600 mb-1.5">
            Table / Location
          </p>
          <input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="e.g. Table 7, Bar Seat 2 (optional)"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/25"
          />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-600 mb-1.5">
            Assign to Org
          </p>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-white/25"
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
      <div className="flex items-center gap-4 p-3 bg-white/[0.02] border border-white/10 rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrUrl}
          alt="NFC UUID QR"
          className="w-[64px] h-[64px] rounded-md bg-white p-1 shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-600">
            Tap URL
          </p>
          <code className="text-[10px] font-mono text-zinc-300 bg-white/5 border border-white/10 px-2 py-1 rounded-md block truncate">
            {fullUrl}
          </code>
          <div className="flex gap-2">
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Test URL
            </a>
            <button
              type="button"
              onClick={() => {
                const qrBig = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=png&margin=12&data=${encodeURIComponent(fullUrl)}`;
                window.open(qrBig, "_blank");
              }}
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors"
            >
              <ScanLine className="w-3 h-3" /> Full QR
            </button>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-zinc-100 transition-colors disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Nfc className="w-4 h-4" />
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
        "border rounded-xl overflow-hidden transition-all",
        tag.isActive
          ? "border-white/10 bg-[#09090b]"
          : "border-red-500/20 bg-red-950/10"
      )}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className={cn(
            "w-2 h-2 rounded-full shrink-0",
            tag.isActive ? "bg-emerald-500" : "bg-red-500"
          )}
        />

        <code className="text-[11px] font-mono text-zinc-300 min-w-0 truncate flex-1">
          {tag.volooTagsUUID}
        </code>

        <span className="text-xs text-zinc-400 shrink-0 hidden sm:block">
          {tag.tableName ?? (
            <span className="text-zinc-600 italic">no table</span>
          )}
        </span>

        <span
          className={cn(
            "text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 hidden md:block",
            org
              ? "bg-white/5 border-white/10 text-white"
              : "bg-zinc-900 border-white/5 text-zinc-600"
          )}
        >
          {org?.name ?? "unassigned"}
        </span>

        <span className="text-xs text-zinc-500 tabular-nums shrink-0">
          {tag.tapCount ?? 0} taps
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleToggleActive}
            title={tag.isActive ? "Deactivate" : "Activate"}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            {tag.isActive ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            title="Edit"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            {editing ? (
              <X className="w-3.5 h-3.5" />
            ) : (
              <Edit3 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={handleDelete}
            title="Delete"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Edit row */}
      {editing && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 flex flex-col sm:flex-row gap-2">
          <input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="Table name…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/25"
          />
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/25"
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
            className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-sm font-semibold hover:bg-zinc-100 transition-colors disabled:opacity-50 shrink-0"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
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
        { label: "Total chips", value: stats.totalTags, icon: Tag },
        { label: "Active", value: stats.activeTags, icon: Wifi },
        { label: "Total taps", value: stats.totalTaps, icon: Activity },
        {
          label: "Unassigned",
          value: stats.unassignedTags,
          icon: AlertTriangle,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STATS.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="p-4 bg-[#09090b] border border-white/10 rounded-xl"
            >
              <Icon className="w-3.5 h-3.5 text-zinc-500 mb-2" />
              <p className="text-2xl font-medium text-white tabular-nums">
                {value}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Provision toggle & Domain config */}
      <div className="bg-[#09090b] border border-white/10 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            onClick={() => setShowProvision((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors"
          >
            {showProvision ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            <Plus className="w-4 h-4" />
            {showProvision ? "Hide provisioning form" : "Provision a new chip"}
          </button>

          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest shrink-0">Tap Domain</span>
            <input
              value={baseDomain}
              onChange={(e) => handleDomainChange(e.target.value)}
              placeholder="e.g. https://ngrok.app"
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-white/25 w-[200px]"
            />
          </div>
        </div>

        {showProvision && (
          <div className="mt-4 border-t border-white/10 pt-4">
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
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search UUID or table name…"
            className="w-full pl-9 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/25"
          />
        </div>
        <select
          value={filterOrg ?? ""}
          onChange={(e) => setFilterOrg(e.target.value || undefined)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-white/25"
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
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3 border border-dashed border-white/10 rounded-2xl">
          <Nfc className="w-9 h-9 text-zinc-700" />
          <p className="text-zinc-400 font-medium text-sm">
            {search ? "No tags match your search" : "No chips provisioned yet"}
          </p>
          <p className="text-xs text-zinc-600">
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
