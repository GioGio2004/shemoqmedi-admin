"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { useTransition, useState, useRef, useEffect } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (nextLocale: string) => {
    setOpen(false);
    if (nextLocale === locale) return;
    startTransition(() => {
      const segments = pathname.split("/");
      if (segments.length > 1) {
        segments[1] = nextLocale;
      } else {
        segments.unshift("", nextLocale);
      }
      const nextUrl = segments.join("/");
      router.replace(nextUrl);
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
      >
        <Globe className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-32 bg-[#18181b] border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50">
          <button
            onClick={() => handleSelect("en")}
            className={cn(
              "w-full text-left px-4 py-2.5 text-xs transition-colors",
              locale === "en" ? "bg-white/10 font-bold text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"
            )}
          >
            🇬🇧 English
          </button>
          <button
            onClick={() => handleSelect("ka")}
            className={cn(
              "w-full text-left px-4 py-2.5 text-xs transition-colors border-t border-white/5",
              locale === "ka" ? "bg-white/10 font-bold text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"
            )}
          >
            🇬🇪 ქართული
          </button>
        </div>
      )}
    </div>
  );
}
