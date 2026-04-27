"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE EMAIL THAT RULES THEM ALL
// This is a hard-coded backstop. Even if the `super_admin` role is somehow
// set on another account, the email must also match this value.
// ─────────────────────────────────────────────────────────────────────────────
const SUPER_ADMIN_EMAIL = "shemoqmedi.voloostudio@gmail.com";

/**
 * Shared guard used by every action in this file.
 * Two-factor check: JWT role claim AND verified email address.
 */
async function assertSuperAdmin() {
  const { userId, sessionClaims } = await auth();

  if (!userId) throw new Error("Unauthorized: Not authenticated.");

  const metadata = sessionClaims?.metadata as { role?: string } | undefined;

  if (metadata?.role !== "super_admin") {
    throw new Error("Unauthorized: Missing super_admin role.");
  }

  // Second factor: verify the actual email on the Clerk user record,
  // not just what's in the token (tokens can be long-lived).
  const client = await clerkClient();
  const clerkUser = await client.users.getUser(userId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (e) => e.id === clerkUser.primaryEmailAddressId
  )?.emailAddress;

  if (primaryEmail !== SUPER_ADMIN_EMAIL) {
    // Log the attempt for audit purposes, but don't expose the allowed email
    console.error(
      `🚨 Super-admin access attempt by unauthorized email: ${primaryEmail}`
    );
    throw new Error("Forbidden: This account is not authorized.");
  }

  return { userId, client };
}

// ─────────────────────────────────────────────────────────────────────────────
// INVITE ADMIN ACTION
// Sends a Clerk organization invitation to the provided email, assigning them
// the "org:admin" role so they can manage their cafe's menu and orders.
// ─────────────────────────────────────────────────────────────────────────────
export async function inviteAdminAction(formData: FormData) {
  const { userId, client } = await assertSuperAdmin();

  const organizationId = formData.get("organizationId") as string;
  const emailAddress = formData.get("emailAddress") as string;

  if (!organizationId || !emailAddress) {
    throw new Error("Organization and email address are required.");
  }

  // Basic email format check — Clerk will validate further server-side
  if (!emailAddress.includes("@")) {
    throw new Error("Invalid email address format.");
  }

  try {
    await client.organizations.createOrganizationInvitation({
      organizationId,
      emailAddress,
      inviterUserId: userId,
      role: "org:admin",
      // Redirect to the dashboard after the invitee signs up/in
      redirectUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/dashboard`,
    });

    console.log(`✅ Invitation sent to ${emailAddress} for org ${organizationId}`);
    revalidatePath("/super-admin");
  } catch (error: any) {
    console.error("Failed to send invitation:", error);
    // Surface Clerk's message (e.g. "already a member", "already invited")
    throw new Error(error.errors?.[0]?.message ?? error.message);
  }
}
