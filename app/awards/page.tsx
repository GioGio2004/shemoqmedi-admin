import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { AwardsManager } from "@/components/admin/AwardsManager";

export const metadata: Metadata = { title: "Awards | Shemoqmedi Admin" };

const TABS = ["awards", "first100", "rounds", "settings", "log"] as const;

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
// ?tab=first100 opens the First 100 giveaway tracker.
export default async function AwardsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initial = TABS.find((t) => t === tab) ?? "awards";
  return (
    <AdminShell>
      <AwardsManager key={initial} initialTab={initial} />
    </AdminShell>
  );
}
