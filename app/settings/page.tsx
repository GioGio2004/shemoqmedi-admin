import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { NotificationsPanel } from "@/components/pwa/NotificationsPanel";
import { ThemePanel } from "@/components/admin/ThemeToggle";

export const metadata: Metadata = { title: "Settings | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function SettingsPage() {
  return (
    <AdminShell>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Settings</p>
          <h1>This device</h1>
          <p>The theme, installing the admin as an app, and whether it may send you notifications.</p>
        </div>
      </div>
      <div className="grid gap-6">
        <ThemePanel />
        <NotificationsPanel />
      </div>
    </AdminShell>
  );
}
