"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { showError } from "@/components/admin/Alerts";
import { isStudioHost } from "@/lib/hosts";
import { deviceLabel } from "./browser";
import { InstallPrompt } from "./InstallPrompt";
import { PushToggle } from "./PushToggle";
import { usePush, type Push } from "./usePush";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function appName(origin: string) {
  try {
    return isStudioHost(new URL(origin).host) ? "Studio" : "Admin";
  } catch {
    return "App";
  }
}

/** Every device that gets this admin's pushes, with a way to drop one. */
function Devices({ push }: { push: Push }) {
  const devices = useQuery(api.push.mySubscriptions, {});
  const forget = useMutation(api.push.unsubscribe);
  if (!devices?.length) return null;
  const here = push.endpoint;
  // This device: switch it off properly (the browser drops its subscription
  // too), or it would be saved again on the next visit.
  const remove = (endpoint: string) => (endpoint === here ? push.disable() : forget({ endpoint })).catch(showError);

  return (
    <div className="pwa-devices">
      <p className="admin-eyebrow">Your devices</p>
      <ul>
        {devices.map((d) => (
          <li key={d.endpoint}>
            <div>
              <p className="pwa-device-name">
                {deviceLabel(d.userAgent)} · {appName(d.origin)}
                {d.endpoint === here && <span className="admin-tag">This device</span>}
              </p>
              <p className="pwa-note">
                Added {DATE.format(d.createdAt)}
                {d.lastOkAt ? ` · last push ${DATE.format(d.lastOkAt)}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              disabled={push.busy}
              onClick={() => remove(d.endpoint)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Settings → Notifications: install the app, turn push on, see your devices. */
export function NotificationsPanel() {
  const push = usePush();
  return (
    <section className="admin-panel pwa-panel" aria-labelledby="notifications-heading">
      <div>
        <p className="admin-eyebrow">Notifications</p>
        <h2 id="notifications-heading">Alerts on your phone</h2>
        <p className="pwa-note">
          New submissions and claims, awards and days without a winner, posts waiting, published or failed,
          token warnings and your reminders. Turn them on in each app you use: the admin and the Studio
          each have their own switch.
        </p>
      </div>
      <InstallPrompt />
      <PushToggle push={push} />
      <Devices push={push} />
    </section>
  );
}
