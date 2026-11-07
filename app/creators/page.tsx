import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { CreatorsTable } from "@/components/admin/CreatorsTable";

export const metadata: Metadata = { title: "Creators | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function CreatorsPage() {
  return (
    <AdminShell>
      <CreatorsTable />
    </AdminShell>
  );
}
