import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ListingCreateForm } from "@/components/admin/ListingCreateForm";

export const metadata: Metadata = { title: "Add a site | Shemoqmedi Admin" };

export default function NewListingPage() {
  return (
    <AdminShell>
      <ListingCreateForm />
    </AdminShell>
  );
}
