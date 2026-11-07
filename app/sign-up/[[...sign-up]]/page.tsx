import { SignUp } from "@clerk/nextjs";
import { SignInFrame } from "@/components/admin/SignInFrame";

export default function SignUpPage() {
  return (
    <SignInFrame>
      <SignUp path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/dashboard" />
    </SignInFrame>
  );
}
