// The short, redacted summary of an MCP tool call's arguments that the
// mcpAudit table keeps (mcp.logCall). Enough to see what Claude did ("send_email
// to a listing's studio, subject …"), never a secret or an address: emails
// become [email], token-like keys and values become [redacted], long text is
// cut, and the whole summary stays short.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Keys whose values are never kept, whatever they hold. */
const SECRET_KEY = /token|secret|password|passwd|authorization|api[-_]?key|cookie|credential/i;
/** Values that look like credentials: our svc. tokens, Clerk/Resend/Meta-style keys, JWTs, long opaque strings. */
const SECRET_VALUE = [
  /\bsvc\.[\w-]+\.[\w-]+/g,
  /\b(?:sk|pk|rk|oat|mt|ak|re)_[A-Za-z0-9_-]{8,}/g,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /\bEAA[A-Za-z0-9]{20,}/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

const MAX_STRING = 80;
const MAX_ITEMS = 10;
const MAX_DEPTH = 4;
export const MAX_SUMMARY = 500;

export function redactText(text: string): string {
  let out = text.replace(EMAIL, "[email]");
  for (const pattern of SECRET_VALUE) out = out.replace(pattern, "[redacted]");
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

function clean(value: unknown, depth: number): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => clean(v, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `…${value.length - MAX_ITEMS} more`] : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : clean(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** The arguments as one short JSON line, redacted. */
export function summarizeArgs(args: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(clean(args ?? {}, 0)) ?? "{}";
  } catch {
    json = '"[unreadable]"';
  }
  return json.length > MAX_SUMMARY ? `${json.slice(0, MAX_SUMMARY)}…` : json;
}
