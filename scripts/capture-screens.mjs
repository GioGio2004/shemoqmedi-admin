#!/usr/bin/env node
// Re-take listing screenshots with a real Chrome (WebGL, intro animations),
// then swap them into Convex storage. Free screenshot services capture too
// early for heavy WebGL / intro sites; this waits until the page has settled.
//
// Usage (from the shemoqmedi-admin folder, with .env.local pointing at the
// deployment you want to change):
//   node scripts/capture-screens.mjs                 # every listing
//   node scripts/capture-screens.mjs obys-agency lusion-award-winning-...
//   node scripts/capture-screens.mjs --wait=12 --prod obys-agency
//
// Env: CHROME_PATH to override the browser location.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}`));
const waitSeconds = Number(flag("wait")?.split("=")[1] ?? 10);
const prod = Boolean(flag("prod"));
const slugs = args.filter((a) => !a.startsWith("--"));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

/** Runs `npx convex run <fn> <json>` and returns the parsed JSON result. */
function convexRun(fn, payload = {}) {
  const json = JSON.stringify(payload);
  const quoted =
    process.platform === "win32" ? `"${json.replace(/"/g, '\\"')}"` : `'${json.replace(/'/g, "'\\''")}'`;
  const out = execSync(`npx convex run ${prod ? "--prod " : ""}${fn} ${quoted}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return out ? JSON.parse(out) : null;
}

async function main() {
  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) throw new Error("Chrome not found. Set CHROME_PATH.");

  const all = convexRun("listings:allForCapture");
  const targets = slugs.length ? all.filter((l) => slugs.includes(l.slug)) : all.filter((l) => l.status !== "rejected");
  const missing = slugs.filter((s) => !all.some((l) => l.slug === s));
  if (missing.length) console.warn(`Unknown slugs skipped: ${missing.join(", ")}`);
  console.log(`Capturing ${targets.length} site(s), waiting ${waitSeconds}s each${prod ? " (PROD)" : ""}.`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars"],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  });

  let ok = 0;
  for (const target of targets) {
    const page = await browser.newPage();
    try {
      await page.goto(target.url, { waitUntil: "networkidle2", timeout: 60_000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      const image = await page.screenshot({ type: "jpeg", quality: 82 });

      const uploadUrl = convexRun("listings:uploadUrlInternal");
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: image });
      if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
      const { storageId } = await res.json();
      convexRun("listings:replaceCoverBySlug", { slug: target.slug, storageId });
      ok++;
      console.log(`✓ ${target.slug}`);
    } catch (err) {
      console.error(`✗ ${target.slug}: ${err instanceof Error ? err.message : err}`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
  console.log(`Done: ${ok}/${targets.length} replaced.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
