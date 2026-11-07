import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignInFrame } from "@/components/admin/SignInFrame";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <SignInFrame>
      <Link href="/sign-in" className="admin-button">
        Sign in to continue <span aria-hidden="true">↗</span>
      </Link>
    </SignInFrame>
  );
}
