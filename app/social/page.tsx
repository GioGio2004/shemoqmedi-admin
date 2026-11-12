import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { SocialQueue, type SocialTab } from "@/components/admin/SocialQueue";

// Kept here: a server page can't read values exported from a "use client" module.
const TABS: SocialTab[] = ["waiting", "scheduled", "sent", "failed", "approved", "rejected", "all"];

export const metadata: Metadata = { title: "Social | Shemoqmedi Admin" };

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
