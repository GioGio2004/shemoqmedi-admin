"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "./browser";
// Loaded with the root layout: Chrome's install offer is caught from the start (installEvent.ts).
import { installOffer } from "./installEvent";

/**
 * Registers public/sw.js once per page load, on both hosts, so an installed
 * app can receive pushes even before notifications are turned on in it, and
 * catches Chrome's install offer for the Install buttons (installEvent.ts).
 * Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    // Already listening since the module loaded; idempotent, and keeps the module in the bundle.
    installOffer.capture(window);
    registerServiceWorker().catch((err: unknown) => {
      // Not fatal: the app works without it, only push is unavailable.
      console.warn("Service worker registration failed", err);
    });
  }, []);
  return null;
}
