import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ListingCreateForm } from "@/components/admin/ListingCreateForm";

export const metadata: Metadata = { title: "Add a site | Shemoqmedi Admin" };

export default function NewListingPage() {
  return (
    <AdminShell>
      {/* The form reads ?juror=<id>; useSearchParams needs a Suspense boundary. */}
      <Suspense fallback={<p className="admin-eyebrow">Loading…</p>}>
        <ListingCreateForm />
      </Suspense>
    </AdminShell>
  );
}
