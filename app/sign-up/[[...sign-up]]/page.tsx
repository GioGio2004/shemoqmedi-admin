import { SignUp } from "@clerk/nextjs";
import { SignInFrame } from "@/components/admin/SignInFrame";
import { onStudioHost } from "@/lib/requestHost";

export default async function SignUpPage() {
  const studio = await onStudioHost();
  return (
    <SignInFrame app={studio ? "studio" : "admin"}>
      <SignUp path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl={studio ? "/" : "/dashboard"} />
    </SignInFrame>
  );
}
