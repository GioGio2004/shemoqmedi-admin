import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { SotdManager } from "@/components/admin/SotdManager";

export const metadata: Metadata = { title: "Site of the Day | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function SotdPage() {
  return (
    <AdminShell>
      <SotdManager />
    </AdminShell>
  );
}
