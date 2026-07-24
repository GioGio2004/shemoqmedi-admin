"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganizationList } from "@clerk/nextjs";
import { toast } from "sonner";
import { joinOrganizationAction } from "../actions";

/**
 * Switch the super admin into any Clerk organization.
 *
 * Two steps:
 *  1. `joinOrganizationAction` — server-side, ensures an org:admin membership
 *     (idempotent: already-a-member counts as success).
 *  2. `setActive` — client-side, makes the org the active one for the session,
 *     then routes to /dashboard so the super admin lands inside that venue.
 */
export function useSwitchIntoOrg() {
  const router = useRouter();
  const { setActive } = useOrganizationList();
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);

  const switchIntoOrg = async (organizationId: string, orgName?: string) => {
    if (switchingOrgId) return;
    setSwitchingOrgId(organizationId);
    try {
      // 1 — Ensure membership (server action, idempotent).
      const result = await joinOrganizationAction({ organizationId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // 2 — Activate the org client-side, then land in its dashboard.
      if (!setActive) {
        toast.error("Clerk is still loading — try again in a moment.");
        return;
      }
      await setActive({ organization: organizationId });
      toast.success(
        orgName ? `Switched into ${orgName}` : "Switched organization"
      );
      router.push("/dashboard");
    } catch (err: unknown) {
      toast.error(
        (err as Error).message ?? "Failed to switch organization."
      );
    } finally {
      setSwitchingOrgId(null);
    }
  };

  return { switchIntoOrg, switchingOrgId };
}
