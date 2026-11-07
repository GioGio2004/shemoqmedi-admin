import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { STOREFRONT_URL } from "@/lib/storefront";

/** Kencho-admin sign-in layout: editorial headline left, form or action right. */
export function SignInFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-signin">
      <header className="signin-header">
        <Link href="/" aria-label="Admin home">
          <Wordmark />
        </Link>
        <a href={STOREFRONT_URL} className="admin-storefront-link" target="_blank" rel="noopener noreferrer">
          Storefront <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main className="signin-main">
        <div className="signin-editorial">
          <p className="admin-eyebrow">shemoqmedi.space · Admin</p>
          <h1>
            Control
            <span>room.</span>
          </h1>
          <p className="signin-description">
            Review submitted websites, decide what goes live, and keep the showcase sharp.
          </p>
        </div>
        <div>{children}</div>
      </main>
    </div>
  );
}
