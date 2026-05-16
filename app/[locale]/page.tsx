"use client";

import Link from "next/link";
import { Authenticated, Unauthenticated } from "convex/react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/MainNavbar";
import { Footer } from "@/components/MainFooter";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-black text-zinc-50 font-sans selection:bg-white/20">
      <Navbar />

      {/* Main Content Area */}
      <main className="flex-grow flex items-center justify-center relative overflow-hidden px-4 py-20 md:py-0">

        {/* Crisp Geometric Accent Instead of Muddy Blurs */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

        <div className="relative z-10 max-w-4xl mx-auto text-center space-y-8">

          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both space-y-4">
            <div className="inline-flex items-center rounded-full border border-white/20 bg-white/5 px-3 py-1 text-sm font-medium text-white mb-4">
              <span className="flex h-2 w-2 rounded-full bg-white animate-pulse mr-2"></span>
              Shemoqmedi v1.0 is Live
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-medium tracking-tight text-white">
              Command your <br className="hidden md:block" />
              <span className="text-zinc-400">
                entire ecosystem.
              </span>
            </h1>

            <p className="max-w-2xl mx-auto text-base md:text-lg text-zinc-400 leading-relaxed pt-4">
              The centralized intelligence hub for your multi-tenant operations. Manage smart menus, NFC table interactions, and real-time orders from a single, frictionless dashboard.
            </p>
          </div>

          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-both flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Unauthenticated>
              <Button asChild size="lg" className="w-full sm:w-auto h-12 px-8 bg-white text-black font-medium hover:bg-zinc-200 shadow-none transition-all rounded-lg">
                <Link href="/sign-up">Deploy Workspace</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto h-12 px-8 border border-white/20 bg-transparent text-zinc-300 hover:text-white hover:bg-white/5 shadow-none rounded-lg transition-all">
                <Link href="/sign-in">Sign In</Link>
              </Button>
            </Unauthenticated>

            <Authenticated>
              <Button asChild size="lg" className="w-full sm:w-auto h-12 px-8 bg-white text-black font-medium hover:bg-zinc-200 shadow-none transition-all rounded-lg group">
                <Link href="/dashboard">
                  Enter Dashboard
                  <span className="ml-2 group-hover:translate-x-1 transition-transform">→</span>
                </Link>
              </Button>
            </Authenticated>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}