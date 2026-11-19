import { clerkClient } from "@clerk/nextjs/server";

/**
 * "Sign in with Shemoqmedi" for MCP clients such as claude.ai and Claude Code.
 * Clerk is the OAuth authorization server: the client sends the person to
 * Clerk, they sign in with their own Shemoqmedi account and press Allow, and
 * the client gets a short-lived access token. No link or token to copy, so
 * nothing to leak.
 *
 * This file is the resource-server side: the metadata that tells clients where
 * to sign in, checking Clerk's tokens, and a signed, short-lived credential
 * that tells Convex which Clerk user the request is for. Convex still decides
 * what that person may do (convex/lib/mcpAuth.ts: platform admins only).
 *
 * Ported from Kalami (kalami/lib/mcp/oauth.ts), which runs the same flow.
 */

/** A credential is minted per request and used within milliseconds; a minute covers slow calls. */
const SERVICE_CREDENTIAL_TTL_MS = 60 * 1000;

/** Clerk's Frontend API (the issuer), read from the publishable key: the Shemoqmedi Clerk instance in production. */
export function clerkIssuer(): string {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encoded = key.split("_")[2] ?? "";
  const domain = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  if (!domain) {
    throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing or malformed");
  }
  return `https://${domain}`;
}

/** The origin people see (Vercel sits behind a proxy), for links and metadata. */
export function publicOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (host) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

/** RFC 9728: tells MCP clients that /api/mcp is protected and Clerk is where to sign in. `docs` is the page that explains the connector. */
export function protectedResourceMetadata(origin: string, docs = "/") {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [clerkIssuer()],
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
    resource_name: "Shemoqmedi",
    resource_documentation: `${origin}${docs}`,
  };
}

/** RFC 8414 metadata of Clerk, served on our origin for clients that look for it here. */
export async function authorizationServerMetadata(): Promise<unknown> {
  const issuer = clerkIssuer();
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    const res = await fetch(`${issuer}${path}`, { next: { revalidate: 3600 } });
    if (res.ok) {
      return await res.json();
    }
  }
  throw new Error("Clerk did not return OAuth metadata");
}

export const METADATA_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "public, max-age=300",
};

type Env = Record<string, string | undefined>;

/**
 * MCP_OAUTH_AUDIENCE (https://admin.shemoqmedi.space/api/mcp, the `resource`
 * in protectedResourceMetadata) binds tokens to this resource server, so a
 * token minted for another app on the same Clerk instance is refused. In
 * production it is required: unset, every MCP request is refused (and logged)
 * instead of accepting any token of the instance. Fails closed on purpose.
 * Development and tests may leave it unset.
 */
export function oauthAudience(env: Env = process.env): { ok: true; audience?: string } | { ok: false; reason: string } {
  const audience = env.MCP_OAUTH_AUDIENCE?.trim();
  if (audience) return { ok: true, audience };
  if (env.NODE_ENV === "production") {
    return { ok: false, reason: "MCP sign-in refused: MCP_OAUTH_AUDIENCE is not set on this deployment (expected https://admin.shemoqmedi.space/api/mcp)." };
  }
  return { ok: true };
}

/**
 * MCP_OAUTH_CLIENT_IDS (optional, comma-separated): only these Clerk OAuth
 * applications may call the connector, e.g. the one made for claude.ai. Clerk
 * checks the audience only on JWT access tokens; this also holds for its
 * default opaque ones. Unset: any client of the instance.
 */
export function clientAllowed(clientId: string | undefined, env: Env = process.env): boolean {
  const list = (env.MCP_OAUTH_CLIENT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 0 || (!!clientId && list.includes(clientId));
}

/** The Clerk user behind an OAuth access token, or null if the token isn't a valid one (or isn't for this server). */
export async function verifyOAuthToken(req: Request): Promise<{ userId: string; scopes: string[]; clientId?: string } | null> {
  const bound = oauthAudience();
  if (!bound.ok) {
    console.error(bound.reason);
    return null;
  }
  const client = await clerkClient();
  const state = await client.authenticateRequest(req, {
    acceptsToken: "oauth_token",
    ...(bound.audience ? { audience: bound.audience } : {}),
  });
  const auth = state.toAuth();
  if (!auth || !auth.isAuthenticated || auth.tokenType !== "oauth_token" || !auth.userId) {
    return null;
  }
  const clientId = auth.clientId ?? undefined;
  if (!clientAllowed(clientId)) {
    console.warn(`MCP sign-in refused: OAuth client ${clientId ?? "(none)"} is not in MCP_OAUTH_CLIENT_IDS.`);
    return null;
  }
  return { userId: auth.userId, scopes: auth.scopes ?? [], clientId };
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * `svc.<payload>.<signature>`: "this request is for Clerk user X, issued at I,
 * until E", signed with MCP_SERVICE_SECRET, which only this server and Convex
 * know. Convex checks the signature, the expiry and that the lifetime is short
 * (convex/lib/tokens.ts), then looks the person up and their role.
 */
export async function serviceCredential(clerkUserId: string): Promise<string> {
  const secret = process.env.MCP_SERVICE_SECRET;
  if (!secret) {
    throw new Error("MCP_SERVICE_SECRET is not set");
  }
  const now = Date.now();
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ u: clerkUserId, i: now, e: now + SERVICE_CREDENTIAL_TTL_MS })),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${base64url(signature)}`;
}
