import "@/app/studio/screens/status.css";
import Link from "next/link";
import { PageHead } from "@/components/studio/ui";

export default function StudioNotFound() {
  return (
    <div className="st-stack-lg">
      <PageHead index="404" section="Studio" title="Not here." />
      <section className="st-glass st-status-lost st-in">
        <span className="st-crow" aria-hidden="true" />
        <p className="st-lede">This page isn&apos;t part of the Studio. The queue, Create, Reels and Reminders are below.</p>
        <div className="st-row">
          <Link href="/" className="st-btn">
            Studio home
          </Link>
          <Link href="/queue" className="st-btn st-btn-ghost">
            Queue
          </Link>
        </div>
      </section>
    </div>
  );
}
