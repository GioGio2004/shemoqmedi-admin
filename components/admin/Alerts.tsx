"use client";

import { useSyncExternalStore } from "react";
import { errorMessage } from "./format";

// App-wide alerts: a small stack in the top-right corner. Any component can
// call showError(err) / showAlert(text) without a provider; <AlertViewport />
// is mounted once in the root layout.

type Tone = "error" | "success";
type Alert = { id: number; tone: Tone; text: string };

const EMPTY: Alert[] = [];
let alerts: Alert[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissAlert(id: number) {
  alerts = alerts.filter((a) => a.id !== id);
  emit();
}

export function showAlert(text: string, tone: Tone = "error") {
  const id = nextId++;
  // The same message twice replaces the old one; keep at most four on screen.
  alerts = [...alerts.filter((a) => a.text !== text), { id, tone, text }].slice(-4);
  emit();
  window.setTimeout(() => dismissAlert(id), tone === "error" ? 8000 : 4000);
}

/** Readable alert for a failed Convex call (or anything else thrown). */
export function showError(err: unknown) {
  showAlert(errorMessage(err), "error");
}

export function AlertViewport() {
  const list = useSyncExternalStore(subscribe, () => alerts, () => EMPTY);
  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed top-4 right-4 z-[1000] grid w-[min(92vw,380px)] gap-2"
    >
      {list.map((alert) => (
        <div
          key={alert.id}
          role="alert"
          className={
            "pointer-events-auto flex items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-sm leading-snug " +
            (alert.tone === "error"
              ? "border-black bg-black text-white"
              : "border-black/15 bg-white text-black")
          }
        >
          <span>{alert.text}</span>
          <button
            type="button"
            onClick={() => dismissAlert(alert.id)}
            aria-label="Dismiss"
            className="-mr-1 grid size-6 shrink-0 place-items-center rounded-full text-base leading-none opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
