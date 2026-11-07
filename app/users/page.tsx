import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { UsersTable } from "@/components/admin/UsersTable";

export const metadata: Metadata = { title: "Users | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function UsersPage() {
  return (
    <AdminShell>
      <UsersTable />
    </AdminShell>
  );
}
