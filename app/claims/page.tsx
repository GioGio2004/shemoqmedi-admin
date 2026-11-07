import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { CLAIM_STATUSES, ClaimsQueue, type ClaimStatus } from "@/components/admin/ClaimsQueue";

export const metadata: Metadata = { title: "Claims | Shemoqmedi Admin" };

function isStatus(value: string | undefined): value is ClaimStatus {
  return CLAIM_STATUSES.some((s) => s === value);
}

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active: ClaimStatus = isStatus(status) ? status : "pending";

  return (
    <AdminShell>
      <ClaimsQueue status={active} />
    </AdminShell>
  );
}
