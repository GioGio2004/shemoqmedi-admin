import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { JuryAdmin } from "@/components/admin/JuryAdmin";

export const metadata: Metadata = { title: "Jury | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function JuryPage() {
  return (
    <AdminShell>
      <JuryAdmin />
    </AdminShell>
  );
}
