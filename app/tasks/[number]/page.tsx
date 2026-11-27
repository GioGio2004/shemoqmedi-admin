import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { TaskDetail } from "@/components/tasks/TaskDetail";

export const metadata: Metadata = { title: "Task | Shemoqmedi Admin" };

export default async function TaskPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return (
    <AdminShell>
      <TaskDetail key={number} number={Number(number)} mode="admin" />
    </AdminShell>
  );
}
