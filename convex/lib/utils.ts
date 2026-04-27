import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";

export async function validateClerkWebhook(
  request: Request
): Promise<WebhookEvent | null> {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SECRET not found in environment");
    return null;
  }

  try {
    const payloadString = await request.text();
    
    const svixHeaders = {
      "svix-id": request.headers.get("svix-id")!,
      "svix-timestamp": request.headers.get("svix-timestamp")!,
      "svix-signature": request.headers.get("svix-signature")!,
    };

    const wh = new Webhook(webhookSecret);
    const event = wh.verify(payloadString, svixHeaders) as unknown as WebhookEvent;
    
    return event;
  } catch (error) {
    console.error("Webhook verification failed:", error);
    return null;
  }
}

// Helper function to extract user data from Clerk webhook
export function extractUserDataFromClerk(clerkUser: any) {
  // Get primary email
  const primaryEmail = clerkUser.email_addresses?.find(
    (email: any) => email.id === clerkUser.primary_email_address_id
  )?.email_address || clerkUser.email_addresses?.[0]?.email_address || '';

  // Get primary phone
  const primaryPhone = clerkUser.phone_numbers?.find(
    (phone: any) => phone.id === clerkUser.primary_phone_number_id
  )?.phone_number || clerkUser.phone_numbers?.[0]?.phone_number || '';

  // Extract name parts
  const firstName = clerkUser.first_name || '';
  const lastName = clerkUser.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim() || primaryEmail.split('@')[0];

  return {
    externalId: clerkUser.id,
    name: firstName || fullName, // Use first name, fallback to full name
    lastname: lastName,
    email: primaryEmail,
    profilePicture: clerkUser.image_url,
    phone: primaryPhone,
    // Set some sensible defaults for new users
    isOpenToWork: false,
    onBoardingCompleted: true,
    preferredContactMethod: 'email',
    updatedAt: Date.now(),
  };
}