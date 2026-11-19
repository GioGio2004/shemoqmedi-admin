/**
 * The MCP audit trail: every tool call is logged once, in one place, so no
 * tool can be added without it. auditTools wraps the server's registerTool:
 * each handler runs as before, then `log` records the tool name, its
 * arguments (Convex redacts emails and tokens and shortens them,
 * convex/lib/mcpAudit.ts), the caller's credential (Convex turns it into the
 * admin's user id) and whether it worked. A failed log is reported and never
 * fails the tool call.
 */

export type AuditEntry = {
  token: string;
  tool: string;
  args: unknown;
  outcome: "ok" | "error";
  error?: string;
};
export type AuditLog = (entry: AuditEntry) => Promise<unknown>;

type ToolResult = { isError?: boolean; content?: { type: string; text?: string }[] };
type Handler = (...params: unknown[]) => unknown;
type Registrar = { registerTool: (name: string, config: unknown, cb: Handler) => unknown };

/** The access credential of a tool call (verifyToken put it in authInfo.token), or "". */
function tokenOf(ctx: unknown): string {
  const token = (ctx as { http?: { authInfo?: { token?: unknown } } } | undefined)?.http?.authInfo?.token;
  return typeof token === "string" ? token : "";
}

function errorText(result: ToolResult): string | undefined {
  const text = result.content?.find((c) => c.type === "text")?.text;
  return text ? text.slice(0, 300) : undefined;
}

/** Wrap one tool handler so its call is logged. Handlers get (args, ctx), or (ctx) when the tool takes no input. */
export function auditedHandler(tool: string, cb: Handler, log: AuditLog): Handler {
  return async (...params: unknown[]) => {
    const ctx = params[params.length - 1];
    const args = params.length > 1 ? params[0] : {};
    const record = async (outcome: "ok" | "error", error?: string) => {
      try {
        await log({ token: tokenOf(ctx), tool, args, outcome, ...(error ? { error } : {}) });
      } catch (err) {
        console.error(`MCP audit log failed for ${tool}`, err instanceof Error ? err.message : err);
      }
    };
    try {
      const result = (await cb(...params)) as ToolResult;
      await record(result?.isError ? "error" : "ok", result?.isError ? errorText(result) : undefined);
      return result;
    } catch (error) {
      await record("error", error instanceof Error ? error.message.slice(0, 300) : "Tool failed");
      throw error;
    }
  };
}

/** Make every tool registered on `server` from now on log its calls. */
export function auditTools<S extends object>(server: S, log: AuditLog): S {
  const target = server as unknown as Registrar;
  const register = target.registerTool.bind(target);
  target.registerTool = (name, config, cb) => register(name, config, auditedHandler(name, cb, log));
  return server;
}
