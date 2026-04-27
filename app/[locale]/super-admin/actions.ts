"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function createOrganizationAction(formData: FormData) {
  const { userId, sessionClaims } = await auth();

  // Tell TypeScript what our custom metadata looks like
  const metadata = sessionClaims?.metadata as { role?: string };

  // 1. Security Check: Block anyone who isn't the Super Admin
  if (metadata?.role !== "super_admin") {
    throw new Error("Unauthorized Access");
  }

  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;

  try {
    const client = await clerkClient();

    // 2. Create the Organization in Clerk
    await client.organizations.createOrganization({
      name,
      slug,
      createdBy: userId!,
    });

    // 3. Refresh the page data
    revalidatePath("/super-admin");
  } catch (error: any) {
    console.error("Failed to create org:", error);
    throw new Error(error.message);
  }
}
