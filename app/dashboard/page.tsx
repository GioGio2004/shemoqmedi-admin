import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { Overview } from "@/components/admin/Overview";

export const metadata: Metadata = { title: "Overview | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function DashboardPage() {
  return (
    <AdminShell>
      <Overview />
    </AdminShell>
  );
}
