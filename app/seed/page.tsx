import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { Importer } from "@/components/admin/Importer";

export const metadata: Metadata = { title: "Import | Shemoqmedi Admin" };

export default function SeedPage() {
  return (
    <AdminShell>
      <Importer />
    </AdminShell>
  );
}
