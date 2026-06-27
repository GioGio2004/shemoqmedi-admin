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

import { useQuery, useMutation, useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bot,
  Database,
  Download,
  CheckCircle2,
  TrendingUp,
  Sparkles,
  Server,
  FileText,
  AlertCircle,
  ShieldCheck,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
const NOOTYPE_COLORS: Record<string, string> = {
  form:       "bg-amber-500/20 text-amber-300 border-amber-500/30",
  overcoming: "bg-red-500/20 text-red-300 border-red-500/30",
  relaxation: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  management: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  baseline:   "bg-zinc-700/30 text-zinc-400 border-zinc-600/30",
};

export function AiTrainingPanel() {
  const convex = useConvex();
  const stats = useQuery(api.aiTrainingLogs.getGlobalStats);
  const recentLogs = useQuery(api.aiTrainingLogs.getRecentLogs, {});
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
      <div className="space-y-6 text-zinc-50 font-sans">
        <div className="animate-pulse">
          <div className="h-8 w-48 bg-white/10 rounded mb-2" />
          <div className="h-4 w-96 bg-white/5 rounded" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="bg-[#09090b] border-white/10 h-[116px] animate-pulse" />
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
        `✅ Exported ${lineCount} valid JSONL lines (${rows.length - lineCount} rows filtered by sanitizer).`
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

  return (
    <section className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-sm font-medium text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-amber-500" />
            Global AI Training Logs
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Monitor Nootype telemetry · Export Gemini 3.5 Flash SFT-ready JSONL datasets
          </p>
        </div>

        {/* Export controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Filter toggle */}
          <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-1 gap-1 text-xs">
            <button
              onClick={() => setExportMode("positive")}
              className={cn(
                "px-3 py-1 rounded-md transition-colors",
                exportMode === "positive"
                  ? "bg-emerald-600 text-white"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              <CheckCircle2 className="w-3 h-3 inline mr-1" />
              High-Quality Only
            </button>
            <button
              onClick={() => setExportMode("all")}
              className={cn(
                "px-3 py-1 rounded-md transition-colors",
                exportMode === "all"
                  ? "bg-amber-600 text-white"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              <Filter className="w-3 h-3 inline mr-1" />
              All Validated
            </button>
          </div>

          <button
            onClick={handleExport}
            disabled={isExporting}
            className={cn(
              "flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs rounded-lg transition-colors",
              isExporting && "opacity-50 cursor-not-allowed"
            )}
          >
            {isExporting ? (
              <Server className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {isExporting ? "Compiling JSONL..." : "Export JSONL"}
          </button>
        </div>
      </div>

      {/* ── SFT Format Notice ── */}
      <div className="flex items-start gap-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs text-blue-300">
        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-400" />
        <div>
          <span className="font-semibold text-blue-200">Gemini 3.5 Flash SFT Format Active — </span>
          Exports are processed by the SFT Sanitizer before download.
          Each JSONL line uses{" "}
          <code className="bg-white/10 px-1 rounded">
            {`{ "systemInstruction": { "role": "system", "parts": [...] }, "contents": [...] }`}
          </code>
          . Internal metadata (nootype labels) is stripped from the output file.
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
        <Card className="bg-[#0f0f11] border-white/5 shadow-none relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">Total Sessions</CardTitle>
            <Database className="h-4 w-4 text-zinc-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-white">{stats.total}</div>
            <p className="text-xs text-zinc-500 mt-1">Platform-wide exchanges</p>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f11] border-white/5 shadow-none relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">High-Quality</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-white">{stats.positive}</div>
            <p className="text-xs text-zinc-500 mt-1">Led to completed checkout</p>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f11] border-white/5 shadow-none relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">Pending Export</CardTitle>
            <Sparkles className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-white">
              {Math.max(0, stats.positive - stats.exported)}
            </div>
            <p className="text-xs text-zinc-500 mt-1">Un-exported high-quality</p>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f11] border-white/5 shadow-none relative overflow-hidden group">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-zinc-400">Readiness Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-white">{progressPercentage}%</div>
            <div className="w-full bg-white/10 rounded-full h-1.5 mt-2">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 mt-1.5">
              Target: {TARGET_MILESTONE.toLocaleString()} positive signals
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Nootype Distribution + Sanitizer Audit ── */}
      <div className="grid gap-6 md:grid-cols-2 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both">
        <Card className="bg-[#0f0f11] border-white/5 shadow-none">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-white flex items-center gap-2">
              Global Nootype Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.breakdown.map((bt) => {
                const totalNootype = stats.total - (stats.unknownNootype ?? 0);
                const percentage =
                  totalNootype > 0 ? Math.round((bt.total / totalNootype) * 100) : 0;
                return (
                  <div key={bt.nootype} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-300 capitalize">{bt.nootype}</span>
                      <span className="text-zinc-500">
                        {percentage}% ({bt.total} total · {bt.positive} ✓)
                      </span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-1.5">
                      <div
                        className="bg-amber-600/80 h-1.5 rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Sanitizer live audit */}
        <Card className="bg-[#0f0f11] border-white/5 shadow-none">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              SFT Sanitizer — Recent Batch Audit
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!auditResult ? (
              <div className="text-xs text-zinc-500">Loading audit...</div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white/5 rounded-lg p-2">
                    <div className="text-lg font-semibold text-white">{auditResult.total}</div>
                    <div className="text-[10px] text-zinc-500">Total Rows</div>
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg p-2">
                    <div className="text-lg font-semibold text-emerald-400">{auditResult.valid}</div>
                    <div className="text-[10px] text-zinc-500">Passes Validation</div>
                  </div>
                  <div className={cn("rounded-lg p-2", auditResult.invalid > 0 ? "bg-red-500/10" : "bg-white/5")}>
                    <div className={cn("text-lg font-semibold", auditResult.invalid > 0 ? "text-red-400" : "text-zinc-500")}>
                      {auditResult.invalid}
                    </div>
                    <div className="text-[10px] text-zinc-500">Rejected</div>
                  </div>
                </div>

                {auditResult.invalid > 0 && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {auditResult.invalid} row(s) have malformed JSON, invalid role sequences, or missing system instructions and will be excluded from exports.
                  </div>
                )}

                <div className="text-[10px] text-zinc-500 pt-1">
                  Breakdown of the 50 most recent logs by nootype:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(auditResult.byNootype).map(([nt, count]) => (
                    <span
                      key={nt}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[11px] border",
                        NOOTYPE_COLORS[nt] ?? NOOTYPE_COLORS.baseline
                      )}
                    >
                      {nt} · {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Raw Telemetry Drawer ── */}
      <div className="mt-8 flex justify-center">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline" className="border-white/10 text-white hover:bg-white/5">
              <FileText className="w-4 h-4 mr-2" />
              View Raw Telemetry Data
            </Button>
          </DrawerTrigger>
          <DrawerContent className="bg-[#0f0f11] border-white/10 text-zinc-50 max-h-[90vh]">
            <div className="mx-auto w-full max-w-5xl">
              <DrawerHeader>
                <DrawerTitle>Raw AI Training Telemetry</DrawerTitle>
                <DrawerDescription className="text-zinc-400">
                  50 most recent exchanges · Toggle between raw DB records and SFT-formatted preview
                </DrawerDescription>
              </DrawerHeader>

              {/* Tab switcher */}
              <div className="flex gap-2 px-4 mb-2">
                <button
                  onClick={() => setDrawerTab("raw")}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded-lg transition-colors",
                    drawerTab === "raw"
                      ? "bg-amber-600 text-white"
                      : "bg-white/5 text-zinc-400 hover:text-white"
                  )}
                >
                  Raw DB Records
                </button>
                <button
                  onClick={() => setDrawerTab("preview")}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded-lg transition-colors",
                    drawerTab === "preview"
                      ? "bg-blue-600 text-white"
                      : "bg-white/5 text-zinc-400 hover:text-white"
                  )}
                >
                  SFT JSONL Preview
                </button>
              </div>

              <div className="p-4 pb-0 overflow-y-auto max-h-[65vh] space-y-4">
                {recentLogs === undefined ? (
                  <div className="flex justify-center p-8">
                    <Server className="w-6 h-6 animate-spin text-zinc-500" />
                  </div>
                ) : recentLogs.length === 0 ? (
                  <div className="text-center p-8 text-zinc-500">No logs recorded yet.</div>
                ) : drawerTab === "raw" ? (
                  // ── Raw view ──
                  recentLogs.map((log: any) => (
                    <div key={log._id} className="border border-white/5 rounded-lg p-4 bg-black/40">
                      <div className="flex items-center gap-3 mb-3 text-xs flex-wrap">
                        <span className="text-amber-500 font-medium font-mono">
                          {log.sessionId.slice(0, 8)}…
                        </span>
                        <span className="text-zinc-500">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                        {log.positiveSignal && (
                          <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            ✓ High Quality
                          </span>
                        )}
                        {log.nootype && (
                          <span className={cn(
                            "px-2 py-0.5 rounded-full capitalize border text-[11px]",
                            NOOTYPE_COLORS[log.nootype] ?? NOOTYPE_COLORS.baseline
                          )}>
                            {log.nootype}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                        {log.contents.map((turn: any, i: number) => (
                          <div
                            key={i}
                            className={cn(
                              "p-3 rounded-lg text-sm",
                              turn.role === "user"
                                ? "bg-white/5 border border-white/10 ml-8"
                                : "bg-amber-500/10 border border-amber-500/20 mr-8"
                            )}
                          >
                            <div className="font-semibold text-[10px] uppercase tracking-wider mb-1 text-zinc-500">
                              {turn.role}
                            </div>
                            <div className="text-zinc-300 break-words whitespace-pre-wrap text-xs">
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
                        <div key={log._id} className="border border-red-500/20 rounded-lg p-3 bg-red-500/5 text-xs">
                          <div className="flex items-center gap-2 text-red-400 mb-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span className="font-mono">{log.sessionId?.slice(0, 8)}… — REJECTED by SFT Sanitizer</span>
                          </div>
                          <div className="text-zinc-500 pl-5">
                            This row will not appear in JSONL exports. Possible causes: empty system instruction, malformed JSON in model turn, or fewer than 2 valid alternating turns.
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
                      <div key={log._id} className="border border-blue-500/20 rounded-lg p-3 bg-blue-500/5">
                        <div className="flex items-center gap-2 mb-2 text-xs">
                          <span className="text-blue-400 font-mono">{log.sessionId?.slice(0, 8)}…</span>
                          <span className={cn(
                            "px-2 py-0.5 rounded-full capitalize border text-[10px]",
                            NOOTYPE_COLORS[sanitized.nootype_label] ?? NOOTYPE_COLORS.baseline
                          )}>
                            {sanitized.nootype_label}
                          </span>
                          {sanitized.positiveSignal && (
                            <span className="text-emerald-400 text-[10px]">✓ High Quality</span>
                          )}
                        </div>
                        <pre className="text-[10px] text-zinc-300 whitespace-pre-wrap break-words bg-black/40 p-2 rounded overflow-x-auto max-h-48">
                          {JSON.stringify(exportLine, null, 2)}
                        </pre>
                      </div>
                    );
                  })
                )}
              </div>

              <DrawerFooter>
                <DrawerClose asChild>
                  <Button variant="outline" className="border-white/10 text-white hover:bg-white/5">
                    Close
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </section>
  );
}
