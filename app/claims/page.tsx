import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ClaimsQueue } from "@/components/admin/ClaimsQueue";
import { CLAIM_STATUSES, type ClaimStatus } from "@/components/admin/format";

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
