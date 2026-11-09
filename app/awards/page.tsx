import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { AwardsManager } from "@/components/admin/AwardsManager";

export const metadata: Metadata = { title: "Awards | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function AwardsPage() {
  return (
    <AdminShell>
      <AwardsManager />
    </AdminShell>
  );
}
