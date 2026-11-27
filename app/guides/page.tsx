import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { Guides } from "@/components/admin/Guides";

export const metadata: Metadata = { title: "Guides | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell and in convex/guides.ts.
export default function GuidesPage() {
  return (
    <AdminShell>
      <Guides />
    </AdminShell>
  );
}
