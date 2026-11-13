"use client";

import { useSyncExternalStore } from "react";
import { reducedMotion } from "./liquid";
import { THEME_ATTR, THEME_BG, THEME_KEY } from "./themeScript";

// Light, Dark, or follow the system. The choice lives in this device's
// localStorage ("studio-theme") and on <html data-studio-theme>, which the
// Studio layout's pre-paint script sets before the first frame.

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readPref(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    apply(readPref());
    cb();
  };
  mq.addEventListener("change", cb);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Puts the choice on <html> and the browser chrome colour in step with it. */
function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute(THEME_ATTR);
  else root.setAttribute(THEME_ATTR, pref);
  const theme: Theme = pref === "system" ? (systemDark() ? "dark" : "light") : pref;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    if (pref === "system") {
      // Back to the per-scheme colours the layout declared.
      const media = m.getAttribute("media") ?? "";
      m.content = media.includes("dark") ? THEME_BG.dark : media.includes("light") ? THEME_BG.light : THEME_BG[theme];
    } else m.content = THEME_BG[theme];
  });
}

/**
 * On launch: the pre-paint script only sets <html>, and the layout's
 * theme-color follows the system, so a saved Light or Dark choice is put on
 * the browser chrome once the Studio has hydrated.
 */
export function syncThemeChrome() {
  apply(readPref());
}

/** Saves the choice for this device and applies it (with the circular reveal when `from` is given). */
export function setThemePref(pref: ThemePref, from?: { x: number; y: number }) {
  const run = () => {
    try {
      if (pref === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, pref);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
    apply(pref);
    emit();
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!from || !doc.startViewTransition || reducedMotion()) return run();
  const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
  doc
    .startViewTransition(run)
    .ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${r}px at ${from.x}px ${from.y}px)`] },
        { duration: 560, easing: "cubic-bezier(.22,.61,.36,1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
}

/** The saved choice; "system" on the server. */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, readPref, () => "system");
}

/** The theme in effect now (the choice, or the system's); "light" on the server. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => {
      const p = readPref();
      return p === "system" ? (systemDark() ? "dark" : "light") : p;
    },
    () => "light",
  );
}
