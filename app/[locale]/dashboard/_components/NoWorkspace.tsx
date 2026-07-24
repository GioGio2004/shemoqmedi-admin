"use client";

import { SignOutButton } from "@clerk/nextjs";
import { ArrowUpRight, LogOut } from "lucide-react";

const CONSUMER_URL =
  process.env.NEXT_PUBLIC_CONSUMER_URL || "https://shemoqmedi.space";

/**
 * Full-screen dead-end for authenticated users with zero org memberships.
 *
 * The venue portal is invitation-only: without a workspace there is nothing
 * to administer, so instead of an empty dashboard shell we explain what this
 * site is and route the visitor to the consumer product (or out the door).
 */
export function NoWorkspace() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-v-bg px-4 py-10">
      {/* Top hairline (matches the sign-in screen) */}
      <div className="v-hairline absolute inset-x-0 top-0" />

      <div className="relative w-full max-w-md text-center animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
        {/* Brand mark */}
        <div className="mx-auto mb-8 flex h-14 w-14 items-center justify-center rounded-v border border-v-line bg-v-bg-raise">
          <span className="font-v-mono text-xl font-medium text-v-ink">S</span>
        </div>

        <p className="v-t-micro mb-3 text-v-faint">
          Shemoqmedi · Venue Portal
        </p>

        <h1 className="font-v-display text-3xl font-medium tracking-tight text-v-ink">
          This is the venue portal
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-v-mut">
          This dashboard is reserved for venue owners and their teams, and
          access is invitation-only. Your account isn&apos;t part of a venue
          workspace yet — a workspace admin has to invite you before anything
          appears here.
        </p>

        <p className="mt-2 text-sm leading-relaxed text-v-faint">
          Looking to browse menus and offers instead? That all lives on the
          consumer site.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href={CONSUMER_URL}
            className="v-press inline-flex w-full items-center justify-center gap-2 rounded-v bg-v-accent px-5 py-2.5 text-sm font-semibold text-v-accent-ink transition-[filter] hover:brightness-95 sm:w-auto"
          >
            Go to Shemoqmedi
            <ArrowUpRight className="h-4 w-4" />
          </a>
          <SignOutButton redirectUrl="/sign-in">
            <button className="v-press inline-flex w-full items-center justify-center gap-2 rounded-v border border-v-line px-5 py-2.5 text-sm font-medium text-v-mut transition-colors hover:bg-white/[0.04] hover:text-v-ink sm:w-auto">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </SignOutButton>
        </div>

        <p className="v-t-micro mt-10 text-v-faint">
          Expecting access? Ask the workspace owner to send an invitation to
          the email you signed in with.
        </p>
      </div>
    </div>
  );
}
