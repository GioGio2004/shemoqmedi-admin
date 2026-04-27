"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Authenticated, Unauthenticated } from "convex/react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/MainNavbar";
import { Footer } from "@/components/MainFooter";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-zinc-50 selection:bg-[#FF8C00]/30">
      <Navbar />

      {/* Main Content Area */}
      <main className="flex-grow flex items-center justify-center relative overflow-hidden px-4 py-20 md:py-0">

        {/* Abstract Background Glows */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#FF8C00]/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-zinc-800/20 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto text-center space-y-8">

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="space-y-4"
          >
            <div className="inline-flex items-center rounded-full border border-[#FF8C00]/30 bg-[#FF8C00]/10 px-3 py-1 text-sm font-medium text-[#FF8C00] backdrop-blur-sm mb-4">
              <span className="flex h-2 w-2 rounded-full bg-[#FF8C00] animate-pulse mr-2"></span>
              Shemoqmedi v1.0 is Live
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-zinc-100">
              Command your <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF8C00] to-yellow-500">
                entire ecosystem.
              </span>
            </h1>

            <p className="max-w-2xl mx-auto text-base md:text-lg text-zinc-400 font-light leading-relaxed pt-4">
              The centralized intelligence hub for your multi-tenant operations. Manage smart menus, NFC table interactions, and real-time orders from a single, frictionless dashboard.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4"
          >
            <Unauthenticated>
              <Button asChild size="lg" className="w-full sm:w-auto h-12 px-8 bg-[#FF8C00] text-black font-semibold hover:bg-[#e67e00] shadow-[0_0_20px_rgba(255,140,0,0.3)] transition-all rounded-full">
                <Link href="/sign-up">Deploy Workspace</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto h-12 px-8 border-zinc-700 bg-transparent text-zinc-300 hover:text-white hover:bg-zinc-900 rounded-full transition-all">
                <Link href="/sign-in">Sign In</Link>
              </Button>
            </Unauthenticated>

            <Authenticated>
              <Button asChild size="lg" className="w-full sm:w-auto h-12 px-8 bg-[#FF8C00] text-black font-semibold hover:bg-[#e67e00] shadow-[0_0_20px_rgba(255,140,0,0.3)] transition-all rounded-full group">
                <Link href="/dashboard">
                  Enter Dashboard
                  <span className="ml-2 group-hover:translate-x-1 transition-transform">→</span>
                </Link>
              </Button>
            </Authenticated>
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}