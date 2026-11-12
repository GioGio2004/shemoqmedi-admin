import { SignIn } from "@clerk/nextjs";
import { SignInFrame } from "@/components/admin/SignInFrame";
import { onStudioHost } from "@/lib/requestHost";

// One sign-in page for both hosts. After signing in without a redirect_url,
// the Studio opens its home (/), the admin its dashboard.
export default async function SignInPage() {
  const studio = await onStudioHost();
  return (
    <SignInFrame app={studio ? "studio" : "admin"}>
      <SignIn path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl={studio ? "/" : "/dashboard"} />
    </SignInFrame>
  );
}
