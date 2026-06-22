"use client";

import { useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  FileJson,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportItem {
  name: Record<string, string>;
  description?: Record<string, string>;
  price: number;
  sortOrder: number;
  tags?: string[];
  accentColor?: string;
  imageUrl?: string;
}

interface ImportCategory {
  name: Record<string, string>;
  sortOrder: number;
  items: ImportItem[];
}

interface ImportPayload {
  categories: ImportCategory[];
}

type ParseResult =
  | { ok: true; payload: ImportPayload; summary: { categories: number; items: number } }
  | { ok: false; error: string };

// ─── Validation ───────────────────────────────────────────────────────────────

function validatePayload(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || !("categories" in raw)) {
    return { ok: false, error: 'Root object must have a "categories" array.' };
  }

  const payload = raw as any;

  if (!Array.isArray(payload.categories) || payload.categories.length === 0) {
    return { ok: false, error: '"categories" must be a non-empty array.' };
  }

  let totalItems = 0;

  for (let ci = 0; ci < payload.categories.length; ci++) {
    const cat = payload.categories[ci];
    if (!cat.name || typeof cat.name !== "object" || !cat.name.en) {
      return { ok: false, error: `categories[${ci}].name must be an object with at least an "en" key.` };
    }
    if (typeof cat.sortOrder !== "number") {
      return { ok: false, error: `categories[${ci}].sortOrder must be a number.` };
    }
    if (!Array.isArray(cat.items)) {
      return { ok: false, error: `categories[${ci}].items must be an array.` };
    }

    for (let ii = 0; ii < cat.items.length; ii++) {
      const item = cat.items[ii];
      if (!item.name || typeof item.name !== "object" || !item.name.en) {
        return { ok: false, error: `categories[${ci}].items[${ii}].name must be an object with at least an "en" key.` };
      }
      if (typeof item.price !== "number" || item.price < 0) {
        return { ok: false, error: `categories[${ci}].items[${ii}].price must be a non-negative number (in tetri/cents).` };
      }
      if (typeof item.sortOrder !== "number") {
        return { ok: false, error: `categories[${ci}].items[${ii}].sortOrder must be a number.` };
      }
      totalItems++;
    }
  }

  return {
    ok: true,
    payload: payload as ImportPayload,
    summary: { categories: payload.categories.length, items: totalItems },
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OrgSelector({
  orgs,
  value,
  onChange,
}: {
  orgs: any[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-white/5 border border-white/10 text-white text-sm rounded-lg px-4 py-2.5 pr-10 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition-all cursor-pointer"
      >
        <option value="" disabled className="bg-zinc-900">
          Select a workspace…
        </option>
        {orgs.map((org: any) => (
          <option key={org._id} value={org.clerkId} className="bg-zinc-900">
            {org.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BulkImportPanel({ organizations }: { organizations: any[] }) {
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [resultMessage, setResultMessage] = useState("");

  const bulkImport = useMutation(api.admin.bulkImportMenu);

  // ── Parse JSON on change ──────────────────────────────────────────────────
  const handleJsonChange = useCallback((value: string) => {
    setRawJson(value);
    setStatus("idle");
    setResultMessage("");

    if (!value.trim()) {
      setParseResult(null);
      return;
    }

    try {
      const parsed = JSON.parse(value);
      setParseResult(validatePayload(parsed));
    } catch {
      setParseResult({ ok: false, error: "Invalid JSON — check for missing commas or brackets." });
    }
  }, []);

  // ── Run import ────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!parseResult?.ok || !selectedOrgId) return;

    setStatus("loading");
    try {
      const result = await bulkImport({
        orgId: selectedOrgId,
        payload: parseResult.payload,
      });
      setStatus("success");
      setResultMessage(result.message);
      setRawJson("");
      setParseResult(null);
    } catch (err: any) {
      setStatus("error");
      setResultMessage(err?.message ?? "An unknown error occurred.");
    }
  };

  // ── Download skeleton ─────────────────────────────────────────────────────
  const handleDownloadSkeleton = () => {
    const link = document.createElement("a");
    link.href = "/menu_import_skeleton.json";
    link.download = "menu_import_skeleton.json";
    link.click();
  };

  const canImport = parseResult?.ok && !!selectedOrgId && status !== "loading";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-sm font-medium text-white">Bulk Menu Import</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Paste a structured JSON payload to seed an entire menu in one operation.
          </p>
        </div>
        <button
          onClick={handleDownloadSkeleton}
          className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
        >
          <Download className="h-3.5 w-3.5" />
          Template JSON
        </button>
      </div>

      {/* Org selector */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
          Target Workspace
        </label>
        <OrgSelector
          orgs={organizations}
          value={selectedOrgId}
          onChange={setSelectedOrgId}
        />
      </div>

      {/* JSON textarea */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
            JSON Payload
          </label>
          {parseResult && (
            <span
              className={`text-[10px] font-medium tabular-nums ${
                parseResult.ok ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {parseResult.ok
                ? `✓ ${parseResult.summary.categories} categories · ${parseResult.summary.items} items`
                : `✗ ${parseResult.error}`}
            </span>
          )}
        </div>

        <div
          className={`relative rounded-xl border transition-colors ${
            parseResult === null
              ? "border-white/10"
              : parseResult.ok
              ? "border-emerald-500/30"
              : "border-red-500/30"
          }`}
        >
          <div className="absolute top-3 left-3 flex items-center gap-1.5 pointer-events-none">
            <FileJson className="h-3.5 w-3.5 text-zinc-600" />
            <span className="text-[10px] font-mono text-zinc-600">JSON</span>
          </div>
          <textarea
            value={rawJson}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder={`{\n  "categories": [\n    {\n      "name": { "en": "Hot Drinks", "ka": "ცხელი სასმელები", "ru": "Горячие напитки" },\n      "sortOrder": 0,\n      "items": [\n        {\n          "name": { "en": "Espresso", "ka": "ესპრესო", "ru": "Эспрессо" },\n          "price": 350,\n          "sortOrder": 0\n        }\n      ]\n    }\n  ]\n}`}
            rows={18}
            spellCheck={false}
            className="w-full bg-transparent text-zinc-300 text-xs font-mono px-4 pt-10 pb-4 resize-none focus:outline-none placeholder:text-zinc-700 leading-relaxed"
          />
        </div>

        {/* Parse error detail */}
        {parseResult && !parseResult.ok && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/8 border border-red-500/20">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{parseResult.error}</p>
          </div>
        )}
      </div>

      {/* Result banner */}
      {status === "success" && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300 font-medium">{resultMessage}</p>
        </div>
      )}
      {status === "error" && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{resultMessage}</p>
        </div>
      )}

      {/* Import button */}
      <button
        onClick={handleImport}
        disabled={!canImport}
        className={`
          w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold
          transition-all duration-200 relative overflow-hidden
          ${canImport
            ? "text-white cursor-pointer hover:opacity-90 active:scale-[0.99]"
            : "text-zinc-600 cursor-not-allowed bg-white/5 border border-white/8"
          }
        `}
        style={canImport ? {
          background: "linear-gradient(135deg, #c2410c 0%, #ea580c 40%, #d97706 100%)",
          boxShadow: "0 0 24px rgba(234,88,12,0.25)",
        } : undefined}
      >
        {status === "loading" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Importing…
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" />
            Import Menu
          </>
        )}
      </button>

      {/* Price convention note */}
      <p className="text-[10px] text-zinc-600 text-center leading-relaxed">
        Prices must be integers in the smallest currency unit.{" "}
        <span className="font-mono">₾5.50 → 550</span>{" "}
        &nbsp;|&nbsp; <span className="font-mono">₾12.00 → 1200</span>
      </p>
    </div>
  );
}
