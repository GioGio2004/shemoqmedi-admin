import { getTranslations } from "next-intl/server";
import { UserButton } from "@clerk/nextjs";
import { CurrentUserCard } from "@/components/auth/CurrentUserCard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

// Protected by proxy.ts: every non-public route requires a Clerk session.
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-mono text-xs tracking-widest uppercase">
          shemoqmedi / admin
        </span>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <UserButton />
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <CurrentUserCard />
      </main>
    </div>
  );
}
