"use client";

import Link from "next/link";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { motion } from "framer-motion";

export function Navbar() {
    return (
        <header className="sticky top-0 z-50 w-full border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
            <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                {/* Brand */}
                <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
                    <div className="w-8 h-8 rounded-lg bg-[#FF8C00] flex items-center justify-center shadow-[0_0_15px_rgba(255,140,0,0.3)]">
                        <span className="text-zinc-950 font-bold text-lg leading-none">V</span>
                    </div>
                    <span className="text-lg font-light tracking-[0.2em] uppercase text-zinc-100 hidden sm:block">
                        shemoqmedi
                    </span>
                </Link>

                {/* Desktop Links (Hidden on Mobile) */}
                <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
                    <Link href="#features" className="hover:text-zinc-100 transition-colors">Features</Link>
                    <Link href="#solutions" className="hover:text-zinc-100 transition-colors">Solutions</Link>
                    <Link href="#pricing" className="hover:text-zinc-100 transition-colors">Pricing</Link>
                </nav>

                {/* Auth Actions */}
                <div className="flex items-center gap-4">
                    <AuthLoading>
                        <Icons.spinner className="h-4 w-4 animate-spin text-zinc-500" />
                    </AuthLoading>

                    <Unauthenticated>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" asChild className="hidden sm:flex text-zinc-300 hover:text-zinc-50 hover:bg-zinc-900">
                                <Link href="/sign-in">Sign In</Link>
                            </Button>
                            <Button asChild className="bg-[#FF8C00] text-black hover:bg-[#e67e00] shadow-[0_0_10px_rgba(255,140,0,0.2)] transition-all">
                                <Link href="/sign-up">Get Started</Link>
                            </Button>
                        </div>
                    </Unauthenticated>

                    <Authenticated>
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" asChild className="hidden sm:flex text-zinc-300 hover:text-zinc-50 hover:bg-zinc-900">
                                <Link href="/dashboard">Dashboard</Link>
                            </Button>
                            <UserButton
                                appearance={{
                                    elements: {
                                        avatarBox: "w-8 h-8 border border-zinc-700",
                                        userButtonPopoverCard: "bg-zinc-950 border border-zinc-800",
                                    }
                                }}
                            />
                        </div>
                    </Authenticated>
                </div>
            </div>
        </header>
    );
}