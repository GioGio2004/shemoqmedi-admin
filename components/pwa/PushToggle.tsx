"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import type { Push, PushState } from "./usePush";

// Why the switch can't be used, in the person's terms.
const BLOCKED: Partial<Record<PushState, string>> = {
  unsupported: "This browser can't receive notifications. Try Chrome, Edge, Firefox or Safari.",
  "needs-install": "On iPhone and iPad, notifications work only in the installed app. Add it to your Home Screen first, then open it from there.",
  "no-key": "Push isn't set up on this deployment yet (NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing).",
  denied: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
};

/**
 * The "notifications on this device" switch, plus a test button once it is
 * on. Takes the page's one usePush() so the device list can share it.
 */
export function PushToggle({ push }: { push: Push }) {
  const sendTest = useAction(api.push.test);
  const [testing, setTesting] = useState(false);

  const toggle = async () => {
    try {
      if (push.state === "on") await push.disable();
      else await push.enable();
    } catch (err) {
      showError(err);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await sendTest({});
      if (!result.configured) showAlert("Push isn't set up on the server yet (the VAPID keys are missing on Convex).");
      else if (result.sent === 0) showAlert("No device took the test. Turn notifications off and on again here.");
      else showAlert(`Test sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`, "success");
    } catch (err) {
      showError(err);
    } finally {
      setTesting(false);
    }
  };

  if (push.state === "loading") return <p className="admin-eyebrow">Checking this device…</p>;
  const blocked = BLOCKED[push.state];
  if (blocked) return <p className="pwa-note">{blocked}</p>;

  const on = push.state === "on";
  return (
    <div className="pwa-push">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="pwa-switch"
        disabled={push.busy}
        onClick={toggle}
      >
        <span className="pwa-switch-track" aria-hidden="true">
          <span className="pwa-switch-thumb" />
        </span>
        Notifications on this device
      </button>
      {on && (
        <button type="button" className="admin-button admin-button-secondary" disabled={testing} onClick={test}>
          {testing ? "Sending…" : "Send a test"}
        </button>
      )}
    </div>
  );
}
