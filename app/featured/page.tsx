import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { FeaturedManager } from "@/components/admin/FeaturedManager";

export const metadata: Metadata = { title: "Featured | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function FeaturedPage() {
  return (
    <AdminShell>
      <FeaturedManager />
    </AdminShell>
  );
}
