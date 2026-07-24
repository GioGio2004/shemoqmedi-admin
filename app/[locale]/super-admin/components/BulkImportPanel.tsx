"use client";

import { useState, useCallback } from "react";
import { useMutation } from "convex/react";
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
        className="w-full cursor-pointer appearance-none rounded-v border border-v-line bg-v-bg px-4 py-2.5 pr-10 text-sm text-v-ink outline-none transition-colors focus:border-v-faint"
      >
        <option value="" disabled>
          Select a workspace…
        </option>
        {orgs.map((org: any) => (
          <option key={org._id} value={org.clerkId}>
            {org.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-v-faint" />
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
      {/* Template download */}
      <div className="flex justify-end">
        <button
          onClick={handleDownloadSkeleton}
          className="v-t-micro v-press flex shrink-0 items-center gap-1.5 rounded-v border border-v-line px-3 py-1.5 text-v-mut transition-colors hover:border-v-faint hover:text-v-ink"
        >
          <Download className="h-3.5 w-3.5" />
          Template JSON
        </button>
      </div>

      {/* Org selector */}
      <div className="space-y-1.5">
        <label className="v-t-micro block text-v-faint">Target Workspace</label>
        <OrgSelector
          orgs={organizations}
          value={selectedOrgId}
          onChange={setSelectedOrgId}
        />
      </div>

      {/* JSON textarea */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="v-t-micro text-v-faint">JSON Payload</label>
          {parseResult && (
            <span
              className={`v-t-micro tabular-nums ${
                parseResult.ok ? "text-v-accent" : "text-red-400"
              }`}
            >
              {parseResult.ok
                ? `OK · ${parseResult.summary.categories} categories · ${parseResult.summary.items} items`
                : "Invalid payload"}
            </span>
          )}
        </div>

        <div
          className={`relative rounded-v border bg-v-bg transition-colors ${
            parseResult === null
              ? "border-v-line"
              : parseResult.ok
              ? "border-v-accent/50"
              : "border-red-500/40"
          }`}
        >
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5">
            <FileJson className="h-3.5 w-3.5 text-v-faint" />
            <span className="v-t-micro text-v-faint">JSON</span>
          </div>
          <textarea
            value={rawJson}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder={`{\n  "categories": [\n    {\n      "name": { "en": "Hot Drinks", "ka": "ცხელი სასმელები", "ru": "Горячие напитки" },\n      "sortOrder": 0,\n      "items": [\n        {\n          "name": { "en": "Espresso", "ka": "ესპრესო", "ru": "Эспрессо" },\n          "price": 350,\n          "sortOrder": 0\n        }\n      ]\n    }\n  ]\n}`}
            rows={18}
            spellCheck={false}
            className="w-full resize-none bg-transparent px-4 pb-4 pt-10 font-v-mono text-xs leading-relaxed text-v-mut outline-none placeholder:text-v-faint"
          />
        </div>

        {/* Parse error detail */}
        {parseResult && !parseResult.ok && (
          <div className="flex items-start gap-2 rounded-v border border-red-500/30 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            <p className="text-xs text-red-400">{parseResult.error}</p>
          </div>
        )}
      </div>

      {/* Result banner */}
      {status === "success" && (
        <div className="flex items-center gap-2.5 rounded-v border border-v-line bg-v-bg px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-v-accent" />
          <p className="text-sm text-v-ink">{resultMessage}</p>
        </div>
      )}
      {status === "error" && (
        <div className="flex items-start gap-2.5 rounded-v border border-red-500/30 px-4 py-3">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-400">{resultMessage}</p>
        </div>
      )}

      {/* Import button — the ONE accent action on this surface */}
      <button
        onClick={handleImport}
        disabled={!canImport}
        className={`v-t-micro v-press flex w-full items-center justify-center gap-2 rounded-v py-3 transition-colors ${
          canImport
            ? "bg-v-accent text-v-accent-ink"
            : "cursor-not-allowed border border-v-line bg-v-bg text-v-faint"
        }`}
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
      <p className="v-t-micro text-center leading-relaxed text-v-faint">
        Prices are integers in the smallest currency unit ·{" "}
        <span className="font-v-mono normal-case">₾5.50 → 550</span>{" "}
        · <span className="font-v-mono normal-case">₾12.00 → 1200</span>
      </p>
    </div>
  );
}
