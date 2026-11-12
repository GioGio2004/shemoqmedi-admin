"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "./browser";

/**
 * Registers public/sw.js once per page load, on both hosts, so an installed
 * app can receive pushes even before notifications are turned on in it.
 * Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    registerServiceWorker().catch((err: unknown) => {
      // Not fatal: the app works without it, only push is unavailable.
      console.warn("Service worker registration failed", err);
    });
  }, []);
  return null;
}
