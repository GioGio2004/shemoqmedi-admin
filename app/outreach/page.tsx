import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { Outreach } from "@/components/admin/Outreach";

export const metadata: Metadata = { title: "Outreach | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function OutreachPage() {
  return (
    <AdminShell>
      <Outreach />
    </AdminShell>
  );
}
