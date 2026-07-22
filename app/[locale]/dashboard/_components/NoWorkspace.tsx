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
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-black px-4 py-10">
      {/* Top gradient hairline (matches the sign-in screen) */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      {/* Soft top glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_60%)]" />

      <div className="relative w-full max-w-md text-center animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
        {/* Brand mark */}
        <div className="mx-auto mb-8 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-lg shadow-black/40">
          <span className="text-xl font-bold text-white">S</span>
        </div>

        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
          Shemoqmedi · Venue Portal
        </p>

        <h1 className="text-3xl font-medium tracking-tight text-white">
          This is the venue portal
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          This dashboard is reserved for venue owners and their teams, and
          access is invitation-only. Your account isn&apos;t part of a venue
          workspace yet — a workspace admin has to invite you before anything
          appears here.
        </p>

        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          Looking to browse menus and offers instead? That all lives on the
          consumer site.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href={CONSUMER_URL}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-200 sm:w-auto"
          >
            Go to Shemoqmedi
            <ArrowUpRight className="h-4 w-4" />
          </a>
          <SignOutButton redirectUrl="/sign-in">
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white sm:w-auto">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </SignOutButton>
        </div>

        <p className="mt-10 text-[11px] text-zinc-600">
          Expecting access? Ask the workspace owner to send an invitation to
          the email you signed in with.
        </p>
      </div>
    </div>
  );
}
