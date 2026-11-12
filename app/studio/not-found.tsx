import Link from "next/link";

export default function StudioNotFound() {
  return (
    <div className="st-stack-lg st-in">
      <header className="st-head">
        <p className="st-eyebrow">
          <b>404</b> Studio
        </p>
        <h1 className="st-h1">Not here.</h1>
      </header>
      <p className="st-lede">This page isn&apos;t part of the Studio. The queue, Create, Reels and Reminders are below.</p>
      <div>
        <Link href="/" className="st-btn">
          Studio home
        </Link>
      </div>
    </div>
  );
}
