"use client";

import { createContext, useContext, useEffect } from "react";

// What the Studio frame (StudioShell) offers the screens: the top bar's small
// title, and a portal host inside the .st scope (so portalled pieces keep the
// Studio's tokens and theme).

export const TitleContext = createContext<(title: string) => void>(() => {});
export const PortalContext = createContext<HTMLElement | null>(null);

/** Shows `title` in the top bar once the page's large title scrolls away. */
export function useStudioTitle(title: string) {
  const set = useContext(TitleContext);
  useEffect(() => {
    set(title);
    return () => set("");
  }, [title, set]);
}

/** The element to portal Studio overlays into (null before the frame mounts). */
export function useStudioPortal() {
  return useContext(PortalContext);
}

// One scroll lock for every overlay (sheets, the picture view): the page under
// them stays put, and the last one to close releases it.
let locks = 0;
export function lockScroll() {
  if (locks++ === 0) document.documentElement.classList.add("st-locked");
}
export function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (!locks) document.documentElement.classList.remove("st-locked");
}

/** Keeps Tab and Shift+Tab inside `container`. Returns true when it moved focus. */
export function trapTab(e: KeyboardEvent | React.KeyboardEvent, container: HTMLElement) {
  if (e.key !== "Tab") return false;
  const items = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), [href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(
    (el) => !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
  );
  if (!items.length) return false;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!container.contains(active)) {
    e.preventDefault();
    first.focus();
    return true;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
