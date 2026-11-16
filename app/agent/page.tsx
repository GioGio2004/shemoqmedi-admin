import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { AgentDeskPage } from "@/components/admin/AgentDesk";

export const metadata: Metadata = { title: "Agent desk | Shemoqmedi Admin" };

export default function AgentPage() {
  return (
    <AdminShell>
      <AgentDeskPage />
    </AdminShell>
  );
}
