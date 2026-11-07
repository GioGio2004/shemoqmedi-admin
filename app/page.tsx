import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const { userId } = await auth();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
        shemoqmedi.space
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Shemoqmedi Admin</h1>
      <p className="max-w-md text-muted-foreground">
        Control room for shemoqmedi.space. Sign in to continue.
      </p>
      <div className="flex gap-3">
        {userId ? (
          <Button asChild size="lg">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        ) : (
          <>
            <Button asChild size="lg">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-up">Create account</Link>
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
