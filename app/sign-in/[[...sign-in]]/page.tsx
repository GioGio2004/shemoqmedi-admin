import { SignIn } from "@clerk/nextjs";
import { SignInFrame } from "@/components/admin/SignInFrame";

export default function SignInPage() {
  return (
    <SignInFrame>
      <SignIn path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/dashboard" />
    </SignInFrame>
  );
}
