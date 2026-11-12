import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { SocialQueue, type SocialTab } from "@/components/admin/SocialQueue";

export const metadata: Metadata = { title: "Social | Shemoqmedi Admin" };

const TABS: SocialTab[] = ["waiting", "approved", "rejected", "all"];

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default async function SocialPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const active = TABS.find((t) => t === status) ?? "waiting";
  return (
    <AdminShell>
      <SocialQueue status={active} />
    </AdminShell>
  );
}
