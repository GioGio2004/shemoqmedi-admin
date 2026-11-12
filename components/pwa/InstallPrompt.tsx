"use client";

import { useSyncExternalStore } from "react";
import { isIos, isStandalone } from "./browser";
import { installOffer } from "./installEvent";

type Platform = "server" | "installed" | "ios" | "other";

function platform(): Platform {
  if (isStandalone()) return "installed";
  return isIos() ? "ios" : "other";
}

// Standalone mode can't change while the page is open; nothing to subscribe to.
const noSubscribe = () => () => {};

/**
 * Install this app: Chrome and Edge get an "Install app" button (their own
 * prompt); iPhone and iPad, which have no prompt, get the Share → "Add to
 * Home Screen" steps, needed there for notifications. Nothing once installed.
 * Chrome's offer is caught at page load (installEvent.ts), so a button that
 * mounts later (a sheet, a page reached by a link) still has it.
 */
export function InstallPrompt() {
  const where = useSyncExternalStore<Platform>(noSubscribe, platform, () => "server");
  const deferred = useSyncExternalStore(installOffer.subscribe, installOffer.get, () => null);

  if (where === "server" || where === "installed") return null;

  if (where === "ios") {
    return (
      <div className="pwa-install">
        <p className="pwa-install-title">Install on your iPhone</p>
        <ol className="pwa-steps">
          <li>
            Tap <strong>Share</strong>
            <ShareIcon />
            in Safari&apos;s toolbar.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>.
          </li>
          <li>Open the app from your Home Screen and turn notifications on there.</li>
        </ol>
      </div>
    );
  }

  if (!deferred) return null;
  // The event can be used once; Chrome fires a new one if it's still installable.
  const install = () => void installOffer.prompt();
  return (
    <div className="pwa-install">
      <p className="pwa-install-title">Install the app</p>
      <p className="pwa-note">Opens in its own window, with notifications even when the tab is closed.</p>
      <button type="button" className="admin-button" onClick={install}>
        Install app
      </button>
    </div>
  );
}

/** Safari's share glyph, so the step matches what's on screen. */
function ShareIcon() {
  return (
    <svg className="pwa-share-icon" viewBox="0 0 16 20" width="14" height="18" aria-label="Share icon" role="img">
      <path d="M8 1v11M4.5 4.5 8 1l3.5 3.5M5 8H2v11h12V8h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
