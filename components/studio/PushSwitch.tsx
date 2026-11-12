"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import type { PushState } from "@/components/pwa/usePush";
import { useStudioPush } from "./StudioShell";
import { Skel, Switch } from "./ui";

// Why the switch can't be used, in plain words.
const BLOCKED: Partial<Record<PushState, string>> = {
  unsupported: "This browser can't receive notifications. Use Chrome, Edge, Firefox or Safari.",
  "needs-install": "On iPhone, notifications work only in the installed app: add the Studio to your Home Screen, then open it from there.",
  "no-key": "Push isn't set up on this deployment yet (NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing).",
  denied: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
};

/** A short word for the Home tile. */
export const PUSH_WORD: Record<PushState, string> = {
  loading: "Checking",
  unsupported: "Unavailable",
  "needs-install": "Install first",
  "no-key": "Not set up",
  denied: "Blocked",
  off: "Off",
  on: "On",
};

/** Notifications on this device (the app's one usePush), with a test once it's on. */
export function PushSwitch({ withTest = true }: { withTest?: boolean }) {
  const push = useStudioPush();
  const sendTest = useAction(api.push.test);
  const [testing, setTesting] = useState(false);

  if (!push || push.state === "loading") return <Skel style={{ height: 52 }} />;
  const blocked = BLOCKED[push.state];
  if (blocked) return <p className="st-note">{blocked}</p>;

  const on = push.state === "on";
  async function toggle(next: boolean) {
    try {
      if (next) await push!.enable();
      else await push!.disable();
    } catch (err) {
      showError(err);
    }
  }
  async function test() {
    setTesting(true);
    try {
      const result = await sendTest({});
      if (!result.configured) showAlert("Push isn't set up on the server yet (the VAPID keys are missing on Convex).");
      else if (result.sent === 0) showAlert("No device took the test. Turn notifications off and on again.");
      else showAlert(`Test sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`, "success");
    } catch (err) {
      showError(err);
    } finally {
      setTesting(false);
    }
  }
  return (
    <div className="st-stack">
      <Switch checked={on} onChange={toggle} disabled={push.busy} label="Notifications" hint={on ? "Posts waiting, published, failed; reminders" : "Off on this device"} />
      {on && withTest && (
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={test} disabled={testing} data-busy={testing}>
          Send a test
        </button>
      )}
    </div>
  );
}
