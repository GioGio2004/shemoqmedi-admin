import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";

// What anyone without the admin role sees on the docs host: no section
// names, no page titles, nothing from the docs themselves.
export function NoAccess({ signedOut }: { signedOut: boolean }) {
  return (
    <section className="docs-gate">
      <div className="docs-gate-block" aria-hidden="true">
        <span className="docs-mark docs-mark-big" />
      </div>
      <div className="docs-gate-text">
        <p className="docs-kicker">
          <span className="docs-num">Docs</span>
          Shemoqmedi team
        </p>
        <h1>
          Team only<span className="docs-dot">.</span>
        </h1>
        <p className="docs-lead">
          {signedOut
            ? "Sign in with your team account to read the docs."
            : "This account doesn't have access to the docs. Ask an admin to give it access, then sign in again."}
        </p>
        <div className="docs-gate-actions">
          {signedOut ? (
            <Link href="/sign-in" className="docs-button">
              Sign in →
            </Link>
          ) : (
            <SignOutButton redirectUrl="/sign-in">
              <button type="button" className="docs-button">
                Use another account
              </button>
            </SignOutButton>
          )}
          <a href="https://www.shemoqmedi.space" className="docs-button docs-button-ghost">
            shemoqmedi.space ↗
          </a>
        </div>
      </div>
    </section>
  );
}
