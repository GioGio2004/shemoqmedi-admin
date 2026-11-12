import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { NotificationsPanel } from "@/components/pwa/NotificationsPanel";

export const metadata: Metadata = { title: "Settings | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function SettingsPage() {
  return (
    <AdminShell>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Settings</p>
          <h1>This device</h1>
          <p>Install the admin as an app and choose whether it may send you notifications.</p>
        </div>
      </div>
      <NotificationsPanel />
    </AdminShell>
  );
}
