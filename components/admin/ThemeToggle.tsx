"use client";

import { useSyncExternalStore } from "react";
import { ADMIN_THEME_ATTR, ADMIN_THEME_KEY, type AdminThemePref } from "@/lib/adminTheme";

// The admin's theme switch: the header button flips light and dark; Settings
// also offers "System". ADMIN_THEME_SCRIPT (app/layout.tsx) applies the
// saved choice before the first paint.

const listeners = new Set<() => void>();

function readPref(): AdminThemePref {
  try {
    const v = window.localStorage.getItem(ADMIN_THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function isDark() {
  return document.documentElement.getAttribute(ADMIN_THEME_ATTR) === "dark";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  // The pre-paint script follows the system itself; read after it ran.
  const later = () => setTimeout(cb, 0);
  mq.addEventListener("change", later);
  window.addEventListener("storage", later);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", later);
    window.removeEventListener("storage", later);
  };
}

export function setAdminTheme(pref: AdminThemePref) {
  try {
    if (pref === "system") window.localStorage.removeItem(ADMIN_THEME_KEY);
    else window.localStorage.setItem(ADMIN_THEME_KEY, pref);
  } catch {
    // storage blocked: applied for this page only
  }
  const run = (window as unknown as { __applyAdminTheme?: () => void }).__applyAdminTheme;
  if (run) run();
  else if (pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches))
    document.documentElement.setAttribute(ADMIN_THEME_ATTR, "dark");
  else document.documentElement.removeAttribute(ADMIN_THEME_ATTR);
  listeners.forEach((l) => l());
}

export function useAdminTheme() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as AdminThemePref);
  return { dark, pref };
}

/** Header button: light ↔ dark. */
export function ThemeToggle() {
  const { dark } = useAdminTheme();
  return (
    <button
      type="button"
      className="admin-theme-toggle"
      aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      onClick={() => setAdminTheme(dark ? "light" : "dark")}
    >
      {dark ? (
        <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="10" cy="10" r="3.6" />
          <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7Z" />
        </svg>
      )}
    </button>
  );
}

const OPTIONS: { value: AdminThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Settings: System (follows the device), Light or Dark. */
export function ThemePanel() {
  const { pref } = useAdminTheme();
  return (
    <section className="admin-panel grid gap-4" aria-labelledby="theme-heading">
      <p id="theme-heading" className="admin-eyebrow">
        Theme
      </p>
      <div role="group" aria-labelledby="theme-heading" className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" className="admin-toggle" aria-pressed={pref === o.value} onClick={() => setAdminTheme(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-sm opacity-60">Dark is the docs&apos; look: charcoal, white type, orange accents. Saved on this device.</p>
    </section>
  );
}
