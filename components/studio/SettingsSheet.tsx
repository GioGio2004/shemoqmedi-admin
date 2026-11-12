"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useState } from "react";
import { showError } from "@/components/admin/Alerts";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ArrowIcon } from "./icons";
import { PushSwitch } from "./PushSwitch";
import { Sheet } from "./ui";

/** Settings: notifications on this device, installing the app, the admin, signing out. */
export function SettingsSheet({ open, onClose, adminOrigin }: { open: boolean; onClose: () => void; adminOrigin: string }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [leaving, setLeaving] = useState(false);

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <section className="st-stack">
        <p className="st-eyebrow">This device</p>
        <PushSwitch />
        <InstallPrompt />
        <p className="st-note">
          Installed from the Home Screen, the Studio opens full screen and gets notifications. Already installed? You are using it now.
        </p>
      </section>
      <hr className="st-rule" />
      <section className="st-stack">
        <p className="st-eyebrow">Account</p>
        {user?.primaryEmailAddress && <p className="st-note">Signed in as <strong>{user.primaryEmailAddress.emailAddress}</strong></p>}
        <div className="st-sheet-foot">
          <a className="st-btn st-btn-ghost" href={`${adminOrigin}/dashboard`} target="_blank" rel="noopener noreferrer">
            Admin <ArrowIcon size={16} />
          </a>
          <button
            type="button"
            className="st-btn"
            data-busy={leaving}
            disabled={leaving}
            onClick={async () => {
              setLeaving(true);
              try {
                await signOut({ redirectUrl: "/sign-in" });
              } catch (err) {
                showError(err);
                setLeaving(false);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    </Sheet>
  );
}
