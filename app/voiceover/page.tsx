import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { Voiceover } from "@/components/admin/Voiceover";

export const metadata: Metadata = { title: "Voiceover | Shemoqmedi Admin" };

// Protected by proxy.ts; admin-only content is gated inside AdminShell.
export default function VoiceoverPage() {
  return (
    <AdminShell>
      <Voiceover />
    </AdminShell>
  );
}
