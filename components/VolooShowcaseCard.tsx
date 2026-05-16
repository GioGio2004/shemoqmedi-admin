"use client";
// components/VolooShowcaseCard.tsx — shared between voice and text chat UIs

import { useState, useEffect, useRef } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { ShowcaseItem } from "@/hooks/useGeminiLive";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function formatPrice(tetri: number): string {
  if (!tetri) return "—";
  const gel = tetri / 100;
  return gel % 1 === 0 ? `₾${gel}` : `₾${gel.toFixed(2)}`;
}

export function ShowcaseCard({
  item, orgId, onSaved,
}: {
  item: ShowcaseItem; orgId: string; onSaved: (id: string, desc: string) => void;
}) {
  const [desc, setDesc] = useState(item.description);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setDesc(item.description); }, [item.description]);

  const onChange = (val: string) => {
    setDesc(val); setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    if (!item.id) return;
    timer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await convex.mutation(api.volooAi.updateItemDescription, { orgId, targetId: item.id!, newDescription: val });
        setSaved(true); onSaved(item.id!, val); setTimeout(() => setSaved(false), 2000);
      } catch { /* silent */ } finally { setSaving(false); }
    }, 800);
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/3 backdrop-blur-sm transition-colors hover:border-white/12"
      style={{ animation: "fadeUp 0.3s ease both" }}>
      <div className={`h-[2px] ${item.isAvailable ? "bg-white/40" : "bg-white/10"}`} />
      <div className="h-36 w-full overflow-hidden relative">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center" style={{
            background: `linear-gradient(135deg, hsl(${(item.name.charCodeAt(0) * 7) % 360},8%,12%) 0%, hsl(${(item.name.charCodeAt(0) * 7 + 40) % 360},6%,18%) 100%)`
          }}>
            <span className="text-3xl opacity-20">{item.category === "Coffee" ? "☕" : item.category === "Tea" ? "🍵" : "✦"}</span>
          </div>
        )}
        <div className="absolute top-2 right-2">
          <span className={`text-[9px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 backdrop-blur-sm border ${item.isAvailable ? "border-white/20 bg-white/10 text-white/80" : "border-white/8 bg-black/50 text-white/30"}`}>
            {item.isAvailable ? "Live" : "Hidden"}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-white leading-snug">{item.name}</h3>
          <span className="shrink-0 text-sm font-bold text-white/70">{formatPrice(item.price)}</span>
        </div>
        <div className="relative">
          <textarea value={desc} onChange={(e) => onChange(e.target.value)} rows={3}
            placeholder="No description — type or ask VolooAI…"
            className="w-full resize-none rounded-xl border border-white/6 bg-white/3 px-3 py-2 text-[11px] text-zinc-400 placeholder-zinc-700 transition-all focus:border-white/15 focus:text-zinc-200 focus:outline-none leading-relaxed" />
          <div className="absolute bottom-2 right-2 text-[9px]">
            {saving && <span className="text-zinc-600">saving…</span>}
            {saved && <span className="text-white/50">saved ✓</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
