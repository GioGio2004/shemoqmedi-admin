import { AdminShell } from "@/components/admin/AdminShell";
import { Overview } from "@/components/admin/Overview";

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function DashboardPage() {
  return (
    <AdminShell>
      <Overview />
    </AdminShell>
  );
}
