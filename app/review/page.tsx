import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReviewQueue } from "@/components/admin/ReviewQueue";
import { REVIEW_STATUSES, type ListingStatus as ReviewStatus } from "@/components/admin/format";

export const metadata: Metadata = { title: "Review | Shemoqmedi Admin" };

function isStatus(value: string | undefined): value is ReviewStatus {
  return REVIEW_STATUSES.some((s) => s === value);
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active: ReviewStatus = isStatus(status) ? status : "pending";

  return (
    <AdminShell>
      <ReviewQueue status={active} />
    </AdminShell>
  );
}
