// lib/ai/sftSanitizer.ts
// ─────────────────────────────────────────────────────────────────────────────
// SFT Data Sanitization Pipeline — Gemini 3.5 Flash
//
// SPEC (Google Cloud Supervised Fine-Tuning, 2025):
// Each JSONL line must be a self-contained training example:
//
//   {
//     "systemInstruction": {          ← OBJECT, not a raw string
//       "role": "system",
//       "parts": [{ "text": "..." }]
//     },
//     "contents": [
//       { "role": "user",  "parts": [{ "text": "..." }] },
//       { "role": "model", "parts": [{ "text": "..." }] }
//     ]
//   }
//
// KEY RULES:
//   - `systemInstruction` must be an object with role:"system" and parts array.
//   - `contents` must strictly alternate user → model.
//   - First turn must be "user". Last turn must be "model".
//   - NO extra top-level keys (e.g. nootype_label must be stripped from output).
//   - JSON must be on a single line per example (JSON Lines format).
// ─────────────────────────────────────────────────────────────────────────────

export interface RawContentTurn {
  role: string;
  parts: Array<{ text: string }>;
}

export interface RawTrainingLog {
  _id?: string;
  /**
   * systemInstruction as stored in Convex — a raw string (the full system prompt).
   * The sanitizer will convert it to the required object shape on export.
   */
  systemInstruction?: string | { role: string; parts: Array<{ text: string }> };
  contents: RawContentTurn[];
  nootype?: string;
  positiveSignal?: boolean;
  rawModelJson?: string;
}

/**
 * The exact structure that Google's Vertex AI SFT pipeline accepts.
 * Each instance of this type serializes to a valid JSONL line.
 * NOTE: nootype_label is intentionally excluded — not a valid SFT field.
 */
export interface SftExportLine {
  systemInstruction: {
    role: "system";
    parts: Array<{ text: string }>;
  };
  contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }>;
}

/**
 * Internal enriched type — includes metadata for admin UI but
 * is NEVER serialized directly to JSONL.
 */
export interface SftSanitizedLog extends SftExportLine {
  _id?: string;
  nootype_label: string;
  positiveSignal: boolean;
}

export class SFTSanitizer {
  /**
   * Sanitizes a raw Convex training log into a spec-compliant SFT record.
   * Returns null if the record is invalid/unrecoverable.
   */
  static sanitizeRecord(log: RawTrainingLog): SftSanitizedLog | null {
    // ── 1. System Instruction → object shape ────────────────────────────────
    // Convex stores this as a raw string; the SFT spec requires an object.
    let systemText = "";
    if (typeof log.systemInstruction === "string") {
      systemText = log.systemInstruction.trim();
    } else if (log.systemInstruction?.parts?.[0]?.text) {
      systemText = log.systemInstruction.parts[0].text.trim();
    }

    if (!systemText) {
      return null; // A training example without a system instruction is invalid
    }

    // ── 2. Clean and validate contents ──────────────────────────────────────
    const cleanedContents: Array<{
      role: "user" | "model";
      parts: Array<{ text: string }>;
    }> = [];

    for (const turn of log.contents) {
      // Normalize role: "assistant" → "model" (legacy compatibility)
      const role: "user" | "model" =
        turn.role === "assistant" || turn.role === "model" ? "model" : "user";

      let textContent = turn.parts?.[0]?.text?.trim() || "";

      // De-escape leaked JSON: if the model turn contains raw JSON blobs like
      // `{"response": "...", "productIds": [...]}`, extract only the prose text.
      if (role === "model" && (textContent.startsWith("{") || textContent.includes('"response":'))) {
        try {
          const parsed = JSON.parse(textContent);
          if (typeof parsed.response === "string") {
            textContent = parsed.response.trim();
          }
        } catch {
          // Regex fallback for partially-malformed JSON
          const match = textContent.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (match?.[1]) {
            textContent = match[1]
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, "\\")
              .replace(/\\n/g, "\n")
              .trim();
          }
        }
      }

      if (!textContent) continue;

      // Enforce strict alternation: merge consecutive same-role turns
      if (cleanedContents.length > 0) {
        const last = cleanedContents[cleanedContents.length - 1];
        if (last.role === role) {
          last.parts[0].text += `\n\n${textContent}`;
          continue;
        }
      }

      // First turn MUST be "user"
      if (cleanedContents.length === 0 && role === "model") continue;

      cleanedContents.push({ role, parts: [{ text: textContent }] });
    }

    // Minimum valid example: at least one user turn + one model turn
    if (cleanedContents.length < 2) return null;

    // Last turn MUST be "model"
    if (cleanedContents[cleanedContents.length - 1].role !== "model") {
      cleanedContents.pop();
    }
    if (cleanedContents.length < 2) return null;

    // ── 3. Return enriched internal record (NOT for direct JSONL output) ────
    return {
      _id: log._id,
      systemInstruction: {
        role: "system",
        parts: [{ text: systemText }],
      },
      contents: cleanedContents,
      nootype_label: log.nootype || "baseline",
      positiveSignal: log.positiveSignal ?? false,
    };
  }

  /**
   * Converts a batch of raw Convex logs into a JSONL string ready for
   * upload to Google Cloud Storage / Vertex AI SFT.
   *
   * IMPORTANT: The exported lines contain ONLY the fields defined in
   * `SftExportLine`. All internal metadata (nootype_label, positiveSignal,
   * _id) is stripped before serialization.
   *
   * @param logs Raw rows from Convex `ai_training_logs` table
   * @param filterPositive If true, only export positive-signal (checkout) rows
   */
  static toJSONL(logs: RawTrainingLog[], filterPositive = false): string {
    return logs
      .filter((log) => !filterPositive || log.positiveSignal === true)
      .map((log) => this.sanitizeRecord(log))
      .filter((log): log is SftSanitizedLog => log !== null)
      .map((log): SftExportLine => ({
        // Explicitly pick only the spec-compliant fields
        systemInstruction: log.systemInstruction,
        contents: log.contents,
      }))
      .map((line) => JSON.stringify(line))
      .join("\n");
  }

  /**
   * Returns stats about a batch without generating the full JSONL.
   * Used by the admin panel to display validation metrics.
   */
  static auditBatch(logs: RawTrainingLog[]): {
    total: number;
    valid: number;
    invalid: number;
    byNootype: Record<string, number>;
    positiveOnly: number;
  } {
    const sanitized = logs
      .map((log) => this.sanitizeRecord(log))
      .filter((log): log is SftSanitizedLog => log !== null);

    const byNootype: Record<string, number> = {};
    for (const s of sanitized) {
      byNootype[s.nootype_label] = (byNootype[s.nootype_label] || 0) + 1;
    }

    return {
      total: logs.length,
      valid: sanitized.length,
      invalid: logs.length - sanitized.length,
      byNootype,
      positiveOnly: sanitized.filter((s) => s.positiveSignal).length,
    };
  }
}
