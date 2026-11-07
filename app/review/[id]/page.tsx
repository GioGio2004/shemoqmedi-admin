import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReviewDetail } from "@/components/admin/ReviewDetail";
import type { Id } from "@/convex/_generated/dataModel";

export const metadata: Metadata = { title: "Review submission | Shemoqmedi Admin" };

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminShell>
      <ReviewDetail id={id as Id<"listings">} />
    </AdminShell>
  );
}
