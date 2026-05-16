import type { Metadata } from "next";
import VolooAiTestUI from "@/components/VolooAiTestUI";

export const metadata: Metadata = {
  title: "VolooAI Manager | Shemoqmedi Admin",
  description:
    "Voice-activated menu control powered by VolooAI. Speak a command to hide or show menu items in real time.",
};

export default function AIManagerPage() {
  return <VolooAiTestUI />;
}
