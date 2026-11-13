"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import { errorMessage } from "@/components/admin/format";
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

type Outcome = { text: string; tone: "error" | "success" };

/** What "Send a test" says, from push.test's answer. */
export function testOutcome(result: { configured: boolean; sent: number }): Outcome {
  if (!result.configured) return { text: "Push isn't set up on the server yet (the VAPID keys are missing on Convex).", tone: "error" };
  if (result.sent === 0) return { text: "No device took the test. Turn notifications off and on again.", tone: "error" };
  return { text: `Test sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`, tone: "success" };
}

/**
 * Notifications on this device (the app's one usePush), with a test once
 * it's on. `inline`: inside a sheet, where the outcome shows in the sheet
 * itself and stays until the next action (a toast only lasts a few seconds).
 */
export function PushSwitch({ withTest = true, inline = false }: { withTest?: boolean; inline?: boolean }) {
  const push = useStudioPush();
  const sendTest = useAction(api.push.test);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const report = (next: Outcome) => (inline ? setOutcome(next) : showAlert(next.text, next.tone));

  if (!push || push.state === "loading") return <Skel style={{ height: 52, borderRadius: 16 }} />;
  const blocked = BLOCKED[push.state];
  if (blocked) return <p className="st-note">{blocked}</p>;

  const on = push.state === "on";
  async function toggle(next: boolean) {
    setOutcome(null);
    try {
      if (next) await push!.enable();
      else await push!.disable();
    } catch (err) {
      if (inline) setOutcome({ text: errorMessage(err), tone: "error" });
      else showError(err);
    }
  }
  async function test() {
    setTesting(true);
    setOutcome(null);
    try {
      report(testOutcome(await sendTest({})));
    } catch (err) {
      if (inline) setOutcome({ text: errorMessage(err), tone: "error" });
      else showError(err);
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
      {outcome && (
        <p className="st-callout" data-tone={outcome.tone === "success" ? "ok" : "error"} role={outcome.tone === "error" ? "alert" : "status"}>
          {outcome.text}
        </p>
      )}
    </div>
  );
}
