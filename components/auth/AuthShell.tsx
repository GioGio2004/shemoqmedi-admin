import Link from "next/link";

/** Centered frame shared by the sign-in and sign-up pages. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <Link
        href="/"
        className="font-mono text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground"
      >
        shemoqmedi.space
      </Link>
      {children}
    </main>
  );
}
