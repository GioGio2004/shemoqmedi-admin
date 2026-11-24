import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmailLog } from "@/components/admin/EmailLog";

export const metadata: Metadata = { title: "Emails | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function EmailsPage() {
  return (
    <AdminShell>
      <EmailLog />
    </AdminShell>
  );
}
