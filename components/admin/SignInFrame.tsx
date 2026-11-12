import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { STOREFRONT_URL } from "@/lib/storefront";

const COPY = {
  admin: {
    eyebrow: "shemoqmedi.space · Admin",
    title: "Control",
    accent: "room.",
    description: "Review submitted websites, decide what goes live, and keep the showcase sharp.",
  },
  studio: {
    eyebrow: "shemoqmedi.space · Studio",
    title: "The",
    accent: "studio.",
    description: "Design, schedule and publish the showcase's posts, stories and reels.",
  },
};

/** Kencho-admin sign-in layout: editorial headline left, form or action right. Used on both hosts. */
export function SignInFrame({ children, app = "admin" }: { children: React.ReactNode; app?: keyof typeof COPY }) {
  const copy = COPY[app];
  return (
    <div className="admin-signin">
      <header className="signin-header">
        <Link href="/" aria-label={app === "studio" ? "Studio home" : "Admin home"}>
          <Wordmark />
        </Link>
        <a href={STOREFRONT_URL} className="admin-storefront-link" target="_blank" rel="noopener noreferrer">
          Storefront <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main className="signin-main">
        <div className="signin-editorial">
          <p className="admin-eyebrow">{copy.eyebrow}</p>
          <h1>
            {copy.title}
            <span>{copy.accent}</span>
          </h1>
          <p className="signin-description">{copy.description}</p>
        </div>
        <div>{children}</div>
      </main>
    </div>
  );
}
