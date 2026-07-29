"use client";

// app/[locale]/super-admin/components/AiTrainingPanel.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Global SFT Training Data Dashboard
//
// JSONL FORMAT (Gemini 3.5 Flash — Vertex AI SFT spec, 2025):
//   Each exported line is a self-contained training example:
//   {
//     "systemInstruction": { "role": "system", "parts": [{ "text": "..." }] },
//     "contents": [
//       { "role": "user",  "parts": [{ "text": "..." }] },
//       { "role": "model", "parts": [{ "text": "..." }] }
//     ]
//   }
//   - NO extra keys (nootype_label etc.) are in the exported file.
//   - The SFTSanitizer in lib/ai/sftSanitizer.ts handles all validation.
// ─────────────────────────────────────────────────────────────────────────────

import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useMemo } from "react";
import {
  Download,
  CheckCircle2,
  Server,
  FileText,
  AlertCircle,
  ShieldCheck,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { SFTSanitizer, type RawTrainingLog } from "@/lib/ai/sftSanitizer";

const TARGET_MILESTONE = 5000;

const ghostBtnCls =
  "v-t-micro v-press inline-flex items-center justify-center gap-2 rounded-v border border-v-line px-4 py-2 text-v-mut hover:text-v-ink hover:border-v-faint transition-colors";

export function AiTrainingPanel() {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const stats = useQuery(
    api.aiTrainingLogs.getGlobalStats,
    isAuthenticated ? {} : "skip",
  );
  const recentLogs = useQuery(
    api.aiTrainingLogs.getRecentLogs,
    isAuthenticated ? {} : "skip",
  );
  const markExported = useMutation(api.aiTrainingLogs.markExported);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<"positive" | "all">("positive");
  const [drawerTab, setDrawerTab] = useState<"raw" | "preview">("raw");

  // ── Live audit of recent logs using the sanitizer ──────────────────────────
  const auditResult = useMemo(() => {
    if (!recentLogs) return null;
    return SFTSanitizer.auditBatch(recentLogs as RawTrainingLog[]);
  }, [recentLogs]);

  if (stats === undefined) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="mb-2 h-6 w-48 rounded-v bg-v-line" />
          <div className="h-4 w-full max-w-sm rounded-v bg-v-bg-raise" />
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-v border border-v-line bg-v-line sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[104px] animate-pulse bg-v-bg-raise" />
          ))}
        </div>
      </div>
    );
  }

  // ── JSONL Export ────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const rows = await convex.query(api.aiTrainingLogs.listGlobalForExport, {
        onlyPositive: exportMode === "positive",
      });

      if (rows.length === 0) {
        toast.info("No training data available for the selected filter.");
        return;
      }

      // Run through the sanitizer — this validates and reformats to SFT spec
      const jsonlString = SFTSanitizer.toJSONL(
        rows as RawTrainingLog[],
        false, // Already filtered at query level
      );

      const lineCount = jsonlString.split("\n").filter(Boolean).length;
      if (lineCount === 0) {
        toast.warning(
          `${rows.length} rows fetched but none passed SFT validation. Check the raw telemetry drawer for malformed data.`
        );
        return;
      }

      // Download
      const blob = new Blob([jsonlString], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().split("T")[0];
      const modeLabel = exportMode === "positive" ? "hq" : "all";
      a.download = `shemoqmedi_sft_${modeLabel}_${dateStr}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Mark as exported in Convex
      const ids = rows.map((r: any) => r._id).filter(Boolean);
      if (ids.length > 0) await markExported({ ids });

      toast.success(
        `Exported ${lineCount} valid JSONL lines (${rows.length - lineCount} rows filtered by sanitizer).`
      );
    } catch (error) {
      console.error("Export failed", error);
      toast.error("Export failed. Check the console for details.");
    } finally {
      setIsExporting(false);
    }
  };

  const progressPercentage = Math.min(
    100,
    Math.round((stats.positive / TARGET_MILESTONE) * 100)
  );

  const STAT_TILES = [
    { label: "Total Sessions", value: stats.total, sub: "Platform-wide exchanges" },
    { label: "High-Quality", value: stats.positive, sub: "Led to completed checkout" },
    {
      label: "Pending Export",
      value: Math.max(0, stats.positive - stats.exported),
      sub: "Un-exported high-quality",
    },
  ];

  return (
    <section className="space-y-6">
      {/* ── Export controls ── */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Filter segmented control */}
        <div className="flex gap-0.5 rounded-v border border-v-line p-0.5">
          <button
            onClick={() => setExportMode("positive")}
            className={cn(
              "v-t-micro v-press flex items-center gap-1.5 rounded-[1px] px-3 py-1.5 transition-colors",
              exportMode === "positive"
                ? "bg-v-ink text-v-bg"
                : "text-v-mut hover:text-v-ink"
            )}
          >
            <CheckCircle2 className="h-3 w-3" />
            High-Quality
          </button>
          <button
            onClick={() => setExportMode("all")}
            className={cn(
              "v-t-micro v-press flex items-center gap-1.5 rounded-[1px] px-3 py-1.5 transition-colors",
              exportMode === "all"
                ? "bg-v-ink text-v-bg"
                : "text-v-mut hover:text-v-ink"
            )}
          >
            <Filter className="h-3 w-3" />
            All Validated
          </button>
        </div>

        {/* Primary action — accent */}
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="v-t-micro v-press flex items-center gap-2 rounded-v bg-v-accent px-4 py-2 text-v-accent-ink disabled:opacity-40"
        >
          {isExporting ? (
            <Server className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {isExporting ? "Compiling JSONL…" : "Export JSONL"}
        </button>
      </div>

      {/* ── SFT Format Notice ── */}
      <div className="flex items-start gap-3 rounded-v border border-v-line bg-v-bg-raise p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-v-mut" />
        <div className="min-w-0 text-xs leading-relaxed text-v-mut">
          <span className="v-t-micro block text-v-faint">
            Gemini 3.5 Flash SFT format active
          </span>
          <span className="mt-1 block">
            Exports are processed by the SFT Sanitizer before download. Each
            JSONL line uses{" "}
            <code className="break-all font-v-mono text-[10px] text-v-faint">
              {`{ "systemInstruction": {…}, "contents": […] }`}
            </code>
            . Internal tracking labels are stripped from the output file.
          </span>
        </div>
      </div>

      {/* ── Stats Grid — hairline tiles, mono numbers ── */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-v border border-v-line bg-v-line sm:grid-cols-4">
        {STAT_TILES.map((t) => (
          <div key={t.label} className="bg-v-bg-raise p-4">
            <p className="v-t-micro text-v-faint">{t.label}</p>
            <p className="mt-1 font-v-mono text-2xl tabular-nums text-v-ink">
              {t.value}
            </p>
            <p className="mt-1 text-[10px] text-v-faint">{t.sub}</p>
          </div>
        ))}

        {/* Readiness — progress toward milestone (accent = live progress) */}
        <div className="bg-v-bg-raise p-4">
          <p className="v-t-micro text-v-faint">Readiness</p>
          <p className="mt-1 font-v-mono text-2xl tabular-nums text-v-ink">
            {progressPercentage}%
          </p>
          <div className="mt-2 h-px w-full bg-v-line">
            <div
              className="h-px bg-v-accent transition-all duration-1000"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] tabular-nums text-v-faint">
            Target: {TARGET_MILESTONE.toLocaleString()} positive signals
          </p>
        </div>
      </div>

      {/* ── Sanitizer Audit ── */}
      <div className="rounded-v border border-v-line bg-v-bg-raise">
        <div className="flex items-center gap-2 border-b border-v-line px-4 py-3">
          <ShieldCheck className="h-3.5 w-3.5 text-v-mut" />
          <p className="v-t-micro text-v-ink">SFT Sanitizer — Recent batch audit</p>
        </div>
        <div className="p-4">
          {!auditResult ? (
            <div className="text-xs text-v-faint">Loading audit…</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-v border border-v-line bg-v-line text-center">
                <div className="bg-v-bg p-3">
                  <div className="font-v-mono text-lg tabular-nums text-v-ink">
                    {auditResult.total}
                  </div>
                  <div className="v-t-micro mt-0.5 text-v-faint">Total Rows</div>
                </div>
                <div className="bg-v-bg p-3">
                  <div className="font-v-mono text-lg tabular-nums text-v-ink">
                    {auditResult.valid}
                  </div>
                  <div className="v-t-micro mt-0.5 text-v-faint">Passes</div>
                </div>
                <div className="bg-v-bg p-3">
                  <div
                    className={cn(
                      "font-v-mono text-lg tabular-nums",
                      auditResult.invalid > 0 ? "text-red-400" : "text-v-faint"
                    )}
                  >
                    {auditResult.invalid}
                  </div>
                  <div className="v-t-micro mt-0.5 text-v-faint">Rejected</div>
                </div>
              </div>

              {auditResult.invalid > 0 && (
                <div className="flex items-start gap-2 rounded-v border border-red-500/30 p-2.5 text-xs text-red-400">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {auditResult.invalid} row(s) have malformed JSON, invalid
                    role sequences, or missing system instructions and will be
                    excluded from exports.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Raw Telemetry Drawer ── */}
      <div className="flex justify-center">
        <Drawer>
          <DrawerTrigger asChild>
            <button className={ghostBtnCls}>
              <FileText className="h-4 w-4" />
              View Raw Telemetry Data
            </button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[90vh] border-v-line bg-v-bg-raise text-v-ink">
            <div className="mx-auto w-full max-w-5xl">
              <DrawerHeader>
                <DrawerTitle className="font-v-display tracking-tight text-v-ink">
                  Raw AI Training Telemetry
                </DrawerTitle>
                <DrawerDescription className="text-v-mut">
                  50 most recent exchanges · Toggle between raw DB records and
                  SFT-formatted preview
                </DrawerDescription>
              </DrawerHeader>

              {/* Tab switcher */}
              <div className="mb-2 flex gap-0.5 self-start rounded-v border border-v-line p-0.5 mx-4 w-fit">
                <button
                  onClick={() => setDrawerTab("raw")}
                  className={cn(
                    "v-t-micro v-press rounded-[1px] px-3 py-1.5 transition-colors",
                    drawerTab === "raw"
                      ? "bg-v-ink text-v-bg"
                      : "text-v-mut hover:text-v-ink"
                  )}
                >
                  Raw DB Records
                </button>
                <button
                  onClick={() => setDrawerTab("preview")}
                  className={cn(
                    "v-t-micro v-press rounded-[1px] px-3 py-1.5 transition-colors",
                    drawerTab === "preview"
                      ? "bg-v-ink text-v-bg"
                      : "text-v-mut hover:text-v-ink"
                  )}
                >
                  SFT JSONL Preview
                </button>
              </div>

              <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4 pb-0">
                {recentLogs === undefined ? (
                  <div className="flex justify-center p-8">
                    <Server className="h-6 w-6 animate-spin text-v-faint" />
                  </div>
                ) : recentLogs.length === 0 ? (
                  <div className="p-8 text-center text-v-faint">
                    No logs recorded yet.
                  </div>
                ) : drawerTab === "raw" ? (
                  // ── Raw view ──
                  recentLogs.map((log: any) => (
                    <div
                      key={log._id}
                      className="rounded-v border border-v-line bg-v-bg p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                        <span className="font-v-mono text-v-ink">
                          {log.sessionId.slice(0, 8)}…
                        </span>
                        <span className="font-v-mono tabular-nums text-v-faint">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                        {log.positiveSignal && (
                          <span className="v-t-micro inline-flex items-center gap-1.5 text-v-ink">
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-v-accent"
                              aria-hidden
                            />
                            High Quality
                          </span>
                        )}
                      </div>
                      <div className="max-h-64 space-y-2 overflow-y-auto pr-2">
                        {log.contents.map((turn: any, i: number) => (
                          <div
                            key={i}
                            className={cn(
                              "rounded-v border border-v-line p-3 text-sm",
                              turn.role === "user"
                                ? "ml-8 bg-v-bg-raise"
                                : "mr-8 bg-v-bg"
                            )}
                          >
                            <div className="v-t-micro mb-1 text-v-faint">
                              {turn.role}
                            </div>
                            <div className="whitespace-pre-wrap break-words text-xs text-v-mut">
                              {turn.parts[0]?.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  // ── JSONL preview view ──
                  recentLogs.map((log: any) => {
                    const sanitized = SFTSanitizer.sanitizeRecord(log as RawTrainingLog);
                    if (!sanitized) {
                      return (
                        <div
                          key={log._id}
                          className="rounded-v border border-red-500/30 p-3 text-xs"
                        >
                          <div className="mb-1 flex items-center gap-2 text-red-400">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span className="font-v-mono">
                              {log.sessionId?.slice(0, 8)}… — REJECTED by SFT Sanitizer
                            </span>
                          </div>
                          <div className="pl-5 text-v-faint">
                            This row will not appear in JSONL exports. Possible
                            causes: empty system instruction, malformed JSON in
                            model turn, or fewer than 2 valid alternating turns.
                          </div>
                        </div>
                      );
                    }
                    // Build the exact export line
                    const exportLine = {
                      systemInstruction: sanitized.systemInstruction,
                      contents: sanitized.contents,
                    };
                    return (
                      <div
                        key={log._id}
                        className="rounded-v border border-v-line bg-v-bg p-3"
                      >
                        <div className="mb-2 flex items-center gap-2 text-xs">
                          <span className="font-v-mono text-v-ink">
                            {log.sessionId?.slice(0, 8)}…
                          </span>
                          {sanitized.positiveSignal && (
                            <span className="v-t-micro inline-flex items-center gap-1.5 text-v-ink">
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-v-accent"
                                aria-hidden
                              />
                              High Quality
                            </span>
                          )}
                        </div>
                        <pre className="max-h-48 overflow-x-auto whitespace-pre-wrap break-words rounded-v border border-v-line bg-v-bg-raise p-2 font-v-mono text-[10px] text-v-mut">
                          {JSON.stringify(exportLine, null, 2)}
                        </pre>
                      </div>
                    );
                  })
                )}
              </div>

              <DrawerFooter>
                <DrawerClose asChild>
                  <button className={ghostBtnCls}>Close</button>
                </DrawerClose>
              </DrawerFooter>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </section>
  );
}
