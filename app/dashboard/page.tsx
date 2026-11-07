import { UserButton } from "@clerk/nextjs";
import { CurrentUserCard } from "@/components/auth/CurrentUserCard";

// Protected by proxy.ts: every non-public route requires a Clerk session.
export default function DashboardPage() {
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-mono text-xs tracking-widest uppercase">
          shemoqmedi / admin
        </span>
        <UserButton />
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground">
            Starter workspace. The new product gets built from here.
          </p>
        </div>
        <CurrentUserCard />
      </main>
    </div>
  );
}
