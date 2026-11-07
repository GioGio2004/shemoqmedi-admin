import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("home");
  const { userId } = await auth();

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
        shemoqmedi.space
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("description")}</p>
      <div className="flex gap-3">
        {userId ? (
          <Button asChild size="lg">
            <Link href={`/${locale}/dashboard`}>{t("goToDashboard")}</Link>
          </Button>
        ) : (
          <>
            <Button asChild size="lg">
              <Link href={`/${locale}/sign-in`}>{t("signIn")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href={`/${locale}/sign-up`}>{t("signUp")}</Link>
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
