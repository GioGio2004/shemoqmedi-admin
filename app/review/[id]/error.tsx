"use client";

import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";

// A malformed id in the URL makes the Convex query throw; show a way back
// instead of a blank crash.
export default function ReviewDetailError({ reset }: { error: Error; reset: () => void }) {
  return (
    <AdminShell>
      <div className="admin-empty">
        <h2>Couldn&apos;t load this listing.</h2>
        The link may be wrong, or the listing was deleted.
        <div className="mt-4 flex flex-wrap gap-4">
          <button type="button" className="admin-text-link" onClick={reset}>
            Try again
          </button>
          <Link href="/review" className="admin-text-link">
            Back to review
          </Link>
        </div>
      </div>
    </AdminShell>
  );
}
