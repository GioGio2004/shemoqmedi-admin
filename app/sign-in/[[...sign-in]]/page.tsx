import { SignIn } from "@clerk/nextjs";
import { SignInFrame } from "@/components/admin/SignInFrame";
import { onDocsHost, onStudioHost } from "@/lib/requestHost";

// One sign-in page for every host. After signing in without a redirect_url,
// the Studio and the docs open their home (/), the admin its dashboard.
export default async function SignInPage() {
  const [studio, docs] = await Promise.all([onStudioHost(), onDocsHost()]);
  return (
    <SignInFrame app={studio ? "studio" : docs ? "docs" : "admin"}>
      <SignIn path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl={studio || docs ? "/" : "/dashboard"} />
    </SignInFrame>
  );
}
