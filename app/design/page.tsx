import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { DesignStudio } from "@/components/admin/DesignStudio";

export const metadata: Metadata = { title: "Design | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function DesignPage() {
  return (
    <AdminShell>
      <DesignStudio />
    </AdminShell>
  );
}
