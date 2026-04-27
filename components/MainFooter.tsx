"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutDashboard, Settings, Compass } from "lucide-react";
import { Authenticated, Unauthenticated } from "convex/react";

export function Footer() {
    const pathname = usePathname();

    const isActive = (path: string) => pathname?.includes(path);

    return (
        <>
            {/* Desktop Footer */}
            <footer className="hidden md:block border-t border-zinc-800/60 bg-zinc-950 py-8 mt-auto">
                <div className="container mx-auto px-4 text-center text-sm text-zinc-500">
                    <p>© {new Date().getFullYear()} Voloo Studios. All rights reserved.</p>
                    <p className="mt-2 tracking-widest uppercase text-[10px]">Shemoqmedi Admin Workspace</p>
                </div>
            </footer>

            {/* Mobile Native Bottom Navigation (PWA) */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-950/80 backdrop-blur-xl border-t border-zinc-800/60 pb-safe">
                <div className="flex items-center justify-around h-16 px-2">

                    <Link href="/" className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${pathname === '/' ? 'text-[#FF8C00]' : 'text-zinc-500 hover:text-zinc-300'}`}>
                        <Home className="w-5 h-5" />
                        <span className="text-[10px] font-medium tracking-wide">Home</span>
                    </Link>

                    <Unauthenticated>
                        <Link href="/sign-in" className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive('/sign-in') ? 'text-[#FF8C00]' : 'text-zinc-500 hover:text-zinc-300'}`}>
                            <Compass className="w-5 h-5" />
                            <span className="text-[10px] font-medium tracking-wide">Explore</span>
                        </Link>
                    </Unauthenticated>

                    <Authenticated>
                        <Link href="/dashboard" className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive('/dashboard') ? 'text-[#FF8C00]' : 'text-zinc-500 hover:text-zinc-300'}`}>
                            <LayoutDashboard className="w-5 h-5" />
                            <span className="text-[10px] font-medium tracking-wide">Dashboard</span>
                        </Link>

                        <Link href="/settings" className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive('/settings') ? 'text-[#FF8C00]' : 'text-zinc-500 hover:text-zinc-300'}`}>
                            <Settings className="w-5 h-5" />
                            <span className="text-[10px] font-medium tracking-wide">Settings</span>
                        </Link>
                    </Authenticated>

                </div>
            </nav>
        </>
    );
}