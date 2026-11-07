import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReviewQueue, type ReviewStatus } from "@/components/admin/ReviewQueue";

export const metadata: Metadata = { title: "Review | Shemoqmedi Admin" };

const STATUSES: ReviewStatus[] = ["pending", "approved", "rejected"];

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = STATUSES.includes(status as ReviewStatus) ? (status as ReviewStatus) : "pending";

  return (
    <AdminShell>
      <ReviewQueue status={active} />
    </AdminShell>
  );
}
