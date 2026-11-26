import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { QuickSubmissions } from "@/components/admin/QuickSubmissions";

export const metadata: Metadata = { title: "Submissions | Shemoqmedi Admin" };

const STATUSES = ["received", "preparing", "listed", "rejected"] as const;
type Status = (typeof STATUSES)[number];

export default async function QuickSubmissionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const active: Status = STATUSES.find((s) => s === status) ?? "received";
  return (
    <AdminShell>
      <QuickSubmissions status={active} />
    </AdminShell>
  );
}
