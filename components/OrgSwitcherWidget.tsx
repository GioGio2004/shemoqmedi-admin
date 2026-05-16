"use client";

import { OrganizationSwitcher } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

/**
 * OrgSwitcherWidget — renders the Clerk OrganizationSwitcher as a client
 * component so it can be embedded inside Server Component pages (super-admin).
 */
export function OrgSwitcherWidget() {
  return (
    <OrganizationSwitcher
      appearance={{
        baseTheme: dark,
        elements: {
          rootBox: "w-full",
          organizationSwitcherTrigger:
            "w-full justify-start gap-3 rounded-xl bg-card border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-accent transition-all duration-150 ring-0 shadow-none",
          organizationSwitcherTriggerIcon: "text-muted-foreground ml-auto",
          organizationPreviewAvatarBox: "h-7 w-7 rounded-lg",
          organizationPreviewTextContainer: "gap-0.5",
          organizationPreviewMainIdentifier: "text-sm font-semibold text-foreground",
          organizationPreviewSecondaryIdentifier: "text-xs text-muted-foreground",
        },
      }}
      hidePersonal
      afterSelectOrganizationUrl="/dashboard"
      afterCreateOrganizationUrl="/dashboard"
    />
  );
}
