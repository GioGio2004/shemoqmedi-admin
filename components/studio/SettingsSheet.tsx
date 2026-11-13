"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useState } from "react";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ArrowIcon } from "./icons";
import { PushSwitch } from "./PushSwitch";
import { setThemePref, useThemePref, type ThemePref } from "./theme";
import { Segmented, Sheet, SheetError } from "./ui";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { value: ThemePref; label: string }[];

/** Settings: notifications on this device, installing the app, the look, the admin, signing out. */
export function SettingsSheet({ open, onClose, adminOrigin }: { open: boolean; onClose: () => void; adminOrigin: string }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const theme = useThemePref();
  const [leaving, setLeaving] = useState(false);
  // Shown in the sheet, next to what failed (a toast only lasts a few seconds).
  const [error, setError] = useState<unknown>(null);

  return (
    <Sheet
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title="Settings"
    >
      <section className="st-stack">
        <p className="st-eyebrow">This device</p>
        <PushSwitch inline />
        <InstallPrompt />
        <p className="st-note">
          Installed from the Home Screen, the Studio opens full screen and gets notifications. Already installed? You are using it now.
        </p>
      </section>
      <section className="st-stack">
        <p className="st-eyebrow" id="st-appearance">
          Appearance
        </p>
        <Segmented options={THEMES} value={theme} onChange={(v) => setThemePref(v)} kind="radio" labelledBy="st-appearance" block />
      </section>
      <section className="st-stack">
        <p className="st-eyebrow">Account</p>
        {user?.primaryEmailAddress && (
          <p className="st-note">
            Signed in as <strong>{user.primaryEmailAddress.emailAddress}</strong>
          </p>
        )}
        <SheetError error={error} />
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
              setError(null);
              try {
                await signOut({ redirectUrl: "/sign-in" });
              } catch (err) {
                setError(err);
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
