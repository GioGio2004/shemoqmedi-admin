import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { Nominees } from "@/components/admin/Nominees";

export const metadata: Metadata = { title: "Nominees | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function NomineesPage() {
  return (
    <AdminShell>
      <Nominees />
    </AdminShell>
  );
}
