#!/usr/bin/env node
// Sets the production Convex environment variables in one go, reading the
// secrets from .env.local so nothing has to be pasted by hand.
//
// Usage (from the shemoqmedi-admin folder):
//   node scripts/prod-env.mjs
//   node scripts/prod-env.mjs --clerk=https://clerk.shemoqmedi.space   # after moving Clerk to the root domain
//   node scripts/prod-env.mjs --clerk-webhook=whsec_...                 # production webhook signing secret
//
// Then deploy the backend:  npx convex deploy

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const INDEXNOW_KEY = "68ad94dedb29ae16ec9627e127004605"; // served at https://www.shemoqmedi.space/<key>.txt
const SITE_URL = "https://www.shemoqmedi.space";

function fromEnvFile(name) {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : undefined;
}

function flag(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

const vars = {
  IMAGEKIT_PRIVATE_KEY: fromEnvFile("IMAGEKIT_PRIVATE_KEY"),
  IMAGEKIT_PUBLIC_KEY: fromEnvFile("NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY"),
  IMAGEKIT_URL_ENDPOINT: fromEnvFile("NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT"),
  INDEXNOW_KEY,
  SITE_URL,
};
if (flag("clerk")) vars.CLERK_FRONTEND_API_URL = flag("clerk").replace(/\/+$/, "");
if (flag("clerk-webhook")) vars.CLERK_WEBHOOK_SECRET = flag("clerk-webhook");

const missing = Object.entries(vars).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}

let failed = 0;
for (const [name, value] of Object.entries(vars)) {
  const res = spawnSync("npx", ["convex", "env", "set", "--prod", name, `"${value}"`], {
    shell: true,
    encoding: "utf8",
  });
  if (res.status === 0) console.log(`✓ ${name}`);
  else {
    failed++;
    console.error(`✗ ${name}: ${(res.stderr || res.stdout).trim().split("\n").pop()}`);
  }
}
console.log(failed ? `${failed} failed.` : "Production Convex env is set. Next: npx convex deploy");
process.exit(failed ? 1 : 0);
