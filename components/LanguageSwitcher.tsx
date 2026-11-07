"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { useTransition, useState, useRef, useEffect } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const LOCALES = [
  { code: "en", label: "English" },
  { code: "ka", label: "ქართული" },
  { code: "ru", label: "Русский" },
] as const;

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
      router.replace(segments.join("/"));
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Change language"
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Globe className="size-4" />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-36 overflow-hidden rounded-lg border bg-popover shadow-lg">
          {LOCALES.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              onClick={() => handleSelect(code)}
              className={cn(
                "w-full px-4 py-2.5 text-left text-xs transition-colors",
                locale === code
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
