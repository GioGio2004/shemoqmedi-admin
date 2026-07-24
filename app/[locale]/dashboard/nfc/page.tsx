"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@clerk/nextjs";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  Loader2, ArrowLeft, Store, Zap, Tag as TagIcon,
  Activity, Plus, X, Smartphone, CheckCheck,
  Nfc, UtensilsCrossed, Hash, Music, Globe,
  Edit3, Copy, ScanLine, ExternalLink, Table2, ChevronRight
} from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { toast, Toaster } from "sonner";
import { Id } from "@/convex/_generated/dataModel";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

// ─── Animation Catalogue ─────────────────────────────────────────────
const ANIMATIONS = [
  { id: "Be-Bold.lottie", label: "Be Bold" },
  { id: "Coffee-love.lottie", label: "Coffee Love" },
  { id: "Gradient Text _ Countdown.lottie", label: "Countdown" },
  { id: "Linkedin-Career-Celebration-Reaction-Recreated.lottie", label: "Celebrate" },
  { id: "RUNWAY-logo.lottie", label: "Runway" },
  { id: "laughing cat.lottie", label: "Laughing Cat" },
  { id: "Ribbon.lottie", label: "Ribbon" },
];

const CAFE_HUB_IMAGE = "https://images.unsplash.com/photo-1554118811-1e0d58224f24?q=80&w=1000&auto=format&fit=crop";

// ─── Interfaces ──────────────────────────────────────────────────────
interface HubForm {
  hubTheme: "dark" | "light" | "orange";
  hubMenuUrl: string;
  wifiSsid: string;
  wifiPassword: string;
  // NOTE: Cafe Hub might use these too in the future, adding for completeness based on old UI
  hubBusinessName?: string;
  hubInstagramUrl?: string;
  hubTiktokUrl?: string;
  hubFacebookUrl?: string;
}

const EMPTY_HUB: HubForm = {
  hubTheme: "dark", hubMenuUrl: "", wifiSsid: "", wifiPassword: "",
  hubBusinessName: "", hubInstagramUrl: "", hubTiktokUrl: "", hubFacebookUrl: ""
};

// ─── Reusable Components ──────────────────────────────────────────────────────
function GlassInput({ label, value, onChange, placeholder, type = "text", icon }: any) {
  return (
    <div className="space-y-1.5">
      <label className="v-t-micro text-v-faint">{label}</label>
      <div className="relative">
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-v-faint">{icon}</div>}
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          style={{ fontSize: "16px" }}
          className={`w-full rounded-v border border-v-line bg-white/[0.03] py-3 text-base text-v-ink placeholder:text-v-faint transition-colors focus:border-v-accent focus:outline-none ${icon ? "pl-10 pr-4" : "px-4"}`} />
      </div>
    </div>
  );
}

// ─── MAIN FLEET DASHBOARD ───────────────────────────────────────────────────
export default function NfcDashboard() {
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();
  const params = useParams();

  // Queries
  const allTags = useQuery(api.volootagsAdmin.getAllPhysicalTags, isLoaded && organization ? { orgId: organization.id } : "skip");
  const orgSettings = useQuery(api.volootagsAdmin.getOrgTagSettings, isLoaded && organization ? { orgId: organization.id } : "skip");

  // Mutations
  const updateTag = useMutation(api.volootagsAdmin.updatePhysicalTag);
  const upsertSettings = useMutation(api.volootagsAdmin.upsertOrgTagSettings);

  // State
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"fleet" | "config" | "motion" | "preview">("fleet");

  const [hubForm, setHubForm] = useState<HubForm>(EMPTY_HUB);
  const [isSavingHub, setIsSavingHub] = useState(false);
  const [carouselIdx, setCarouselIdx] = useState(0);

  // Tag rename states
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editTableName, setEditTableName] = useState("");

  const activeTag = allTags?.find((t: any) => t._id === selectedTagId);
  const currentAnim = ANIMATIONS[carouselIdx] || ANIMATIONS[0];
  const savedAnim = orgSettings?.selectedAnimation || ANIMATIONS[0].id;
  const isAnimationVisible = orgSettings?.showAnimation !== false;

  useEffect(() => {
    if (orgSettings) {
      const saved = orgSettings.selectedAnimation || ANIMATIONS[0].id;
      const idx = ANIMATIONS.findIndex(a => a.id === saved);
      if (idx !== -1) setCarouselIdx(idx);

      setHubForm({
        hubTheme: (orgSettings.hubTheme as any) || "dark",
        hubMenuUrl: orgSettings.hubMenuUrl || "",
        wifiSsid: orgSettings.wifiSsid || "",
        wifiPassword: orgSettings.wifiPassword || "",
      });
    }
  }, [orgSettings]);

  const saveHubConfig = async () => {
    if (!organization) return;
    setIsSavingHub(true);
    try {
      await upsertSettings({
        orgId: organization.id,
        activeMode: "cafe_hub",
        showAnimation: isAnimationVisible,
        selectedAnimation: savedAnim,
        hubTheme: hubForm.hubTheme,
        hubMenuUrl: hubForm.hubMenuUrl,
        wifiSsid: hubForm.wifiSsid,
        wifiPassword: hubForm.wifiPassword,
      });
      toast.success("Global config saved!");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      toast.error("Error saving config.");
    } finally {
      setIsSavingHub(false);
    }
  };

  const saveAnimation = async (animId: string) => {
    if (!organization) return;
    try {
      await upsertSettings({
        orgId: organization.id,
        activeMode: "cafe_hub",
        showAnimation: isAnimationVisible,
        selectedAnimation: animId,
        hubTheme: hubForm.hubTheme,
        hubMenuUrl: hubForm.hubMenuUrl,
      });
      toast.success("Global animation updated.");
    } catch { toast.error("Failed to save animation."); }
  };

  const toggleAnimationVisibility = async () => {
    if (!organization) return;
    try {
      await upsertSettings({
        orgId: organization.id,
        activeMode: "cafe_hub",
        showAnimation: !isAnimationVisible,
        selectedAnimation: savedAnim,
        hubTheme: hubForm.hubTheme,
      });
      toast.success(isAnimationVisible ? "Animations disabled for cafe." : "Animations enabled for cafe.");
    } catch { toast.error("Failed to update visibility."); }
  };

  const saveTableRename = async (tagId: string) => {
    try {
      await updateTag({ tagId: tagId as Id<"physicalTags">, tableName: editTableName.trim() || undefined });
      toast.success("Table renamed.");
      setEditingTableId(null);
    } catch (e: any) { toast.error(e.message || "Failed to rename table."); }
  };

  if (!isLoaded || allTags === undefined || orgSettings === undefined) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-v-bg">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-v-faint" />
      </div>
    );
  }

  const totalTaps = (allTags ?? []).reduce((s: number, t: any) => s + (t.tapCount ?? 0), 0);
  const activeTags = (allTags ?? []).filter((t: any) => t.isActive).length;

  return (
    <div className="min-h-[100dvh] bg-v-bg text-v-ink flex flex-col font-sans">
      <Toaster position="bottom-right" theme="dark" richColors />

      {/* ── DESKTOP TOP NAV / HEADER ── */}
      <div className="sticky top-0 z-40 flex-shrink-0 border-b border-v-line bg-v-bg">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <div className="v-t-micro flex items-center gap-2 text-v-ink">
            <Nfc className="w-5 h-5 text-v-accent" />
            NFC Fleet
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Activity className="ml-1 h-5 w-5 text-v-faint" />
          </div>
        </div>
      </div>

      {/* ── FOOTER TAB NAV (MOBILE) ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-v-line bg-v-bg pb-[env(safe-area-inset-bottom,0px)]">
        <div className="max-w-2xl mx-auto px-2 py-2 flex items-center justify-between">
          {[
            { id: "fleet", label: "Fleet", icon: Nfc },
            { id: "config", label: "Hub Settings", icon: Store },
            { id: "motion", label: "Motion", icon: Zap },
            { id: "preview", label: "Preview", icon: UtensilsCrossed },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                className="v-press group flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 py-1 transition-all">
                <div className="flex h-8 w-12 items-center justify-center transition-all">
                  <Icon className={`w-5 h-5 transition-colors ${isActive ? 'text-v-accent' : 'text-v-faint group-hover:text-v-mut'}`} />
                </div>
                <span className={`max-w-full truncate font-v-mono text-[9px] uppercase tracking-[0.06em] transition-colors ${isActive ? 'text-v-accent' : 'text-v-faint'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── MAIN LAYOUT ── */}
      <div className="flex-1 overflow-hidden flex max-w-5xl mx-auto w-full">
        {/* DESKTOP SIDEBAR */}
        <div className="hidden md:flex flex-col w-56 pt-8 pr-6 border-r border-v-line mr-6 h-full overflow-y-auto">
          <div className="space-y-1">
            {[
              { id: "fleet", label: "Fleet & Tables", icon: Nfc },
              { id: "config", label: "Global Settings", icon: Store },
              { id: "motion", label: "Animations", icon: Zap },
              { id: "preview", label: "Theme Preview", icon: UtensilsCrossed },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                  className={`v-t-micro v-press w-full flex items-center gap-3 px-4 py-3 rounded-v transition-colors
                    ${isActive ? 'text-v-accent' : 'text-v-mut hover:bg-white/[0.04] hover:text-v-ink'}`}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {isActive && <span className="ml-auto h-1 w-1 rounded-full bg-v-accent" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="flex-1 overflow-y-auto pb-28 md:pb-8">
          <div className="max-w-2xl mx-auto px-4 lg:px-0 py-8 space-y-6">

            {/* ════ FLEET TAB ════ */}
            {activeTab === "fleet" && (
              <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-2 flex items-center justify-between border-b border-v-line pb-2">
                  <h2 className="v-t-micro text-v-mut">01 — Active chips</h2>
                  <span className="v-t-micro rounded-full border border-v-accent/40 px-3 py-1 tabular-nums text-v-accent">{activeTags} Active</span>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="flex flex-col justify-center rounded-v border border-v-line bg-v-bg-raise p-5">
                    <h4 className="v-t-micro mb-1 text-v-faint">Total Assigned</h4>
                    <span className="font-v-display text-3xl font-medium tabular-nums tracking-tight text-v-ink">{allTags.length}</span>
                  </div>
                  <div className="flex flex-col justify-center rounded-v border border-v-line bg-v-bg-raise p-5">
                    <h4 className="v-t-micro mb-1 text-v-faint">Fleet Taps</h4>
                    <span className="font-v-display text-3xl font-medium tabular-nums tracking-tight text-v-ink">{totalTaps}</span>
                  </div>
                </div>

                {allTags.length === 0 ? (
                  <div className="rounded-v border border-v-line bg-v-bg-raise px-6 py-16 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-v border border-v-line">
                      <Nfc className="h-8 w-8 text-v-faint" />
                    </div>
                    <h3 className="mb-2 text-lg font-medium text-v-ink">No Chips Assigned</h3>
                    <p className="text-sm text-v-mut">Contact Shemoqmedi to provision hardware for your cafe.</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {allTags.map((tag: any, i: number) => {
                      const isEditing = editingTableId === tag._id;
                      const tapUrl = typeof window !== "undefined" ? `${window.location.origin}/t/${tag.volooTagsUUID}` : `/t/${tag.volooTagsUUID}`;

                      return (
                        <div key={tag._id} className="relative w-full overflow-hidden rounded-v border border-v-line bg-v-bg-raise transition-colors group hover:border-v-accent/30">
                          <div className="p-5 flex flex-col gap-3">
                            {/* Header */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`flex h-10 w-10 items-center justify-center rounded-full border ${tag.isActive ? 'border-v-accent/40 bg-v-accent/10 text-v-accent' : 'border-red-400/25 bg-red-400/10 text-red-400'}`}>
                                  <Nfc className="w-5 h-5" />
                                </div>
                                <div>
                                  {isEditing ? (
                                    <div className="flex items-center gap-2">
                                      <input
                                        autoFocus
                                        value={editTableName}
                                        onChange={e => setEditTableName(e.target.value)}
                                        onKeyDown={e => e.key === "Enter" && saveTableRename(tag._id)}
                                        placeholder="Table name..."
                                        className="w-32 rounded-v border border-v-line bg-v-bg px-2 py-1 text-sm text-v-ink outline-none focus:border-v-accent"
                                      />
                                      <button onClick={() => saveTableRename(tag._id)} className="text-v-accent hover:brightness-110"><CheckCheck className="w-4 h-4" /></button>
                                      <button onClick={() => setEditingTableId(null)} className="text-v-faint hover:text-v-ink"><X className="w-4 h-4" /></button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 group/edit cursor-pointer" onClick={() => { setEditingTableId(tag._id); setEditTableName(tag.tableName || ""); }}>
                                      <h3 className="text-lg font-medium tracking-tight text-v-ink">{tag.tableName || `Chip ${i + 1}`}</h3>
                                      <Edit3 className="w-3 h-3 text-v-faint group-hover/edit:text-v-ink transition-colors" />
                                    </div>
                                  )}
                                  <p className="v-t-micro mt-0.5 tabular-nums text-v-mut">
                                    {tag.tapCount} Taps
                                  </p>
                                </div>
                              </div>
                              <span className={`v-t-micro rounded-v border px-2 py-1 ${tag.isActive ? 'border-v-accent/40 text-v-accent' : 'border-v-line text-v-faint'}`}>
                                {tag.isActive ? "Online" : "Offline"}
                              </span>
                            </div>

                            {/* UUID & Tap Info */}
                            <div className="pt-3 border-t border-v-line flex flex-col gap-2">
                              <div className="flex items-center gap-2 rounded-v border border-v-line bg-v-bg px-3 py-2">
                                <span className="v-t-micro shrink-0 text-v-faint">UUID</span>
                                <code className="flex-1 truncate font-v-mono text-xs text-v-mut">{tag.volooTagsUUID}</code>
                                <button onClick={() => { navigator.clipboard.writeText(tag.volooTagsUUID); toast.success("UUID Copied"); }} className="text-v-faint hover:text-v-ink"><Copy className="w-3.5 h-3.5" /></button>
                              </div>
                              <div className="flex items-center gap-2 px-1">
                                <a href={tapUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-v-accent hover:underline">
                                  Test Tap <ExternalLink className="w-3 h-3" />
                                </a>
                                <span className="text-v-faint">•</span>
                                <button onClick={() => window.open(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=png&margin=12&data=${encodeURIComponent(tapUrl)}`, "_blank")} className="flex items-center gap-1 text-xs text-v-mut hover:text-v-ink">
                                  View QR <ScanLine className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ════ CONFIG TAB (Global Settings) ════ */}
            {activeTab === "config" && (
              <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-2 flex items-center justify-between border-b border-v-line pb-2">
                  <h2 className="v-t-micro text-v-mut">02 — Hub settings</h2>
                  <span className="v-t-micro rounded-full border border-v-line px-3 py-1 text-v-faint">Global Profile</span>
                </div>

                <div className="rounded-v border border-v-line bg-v-bg-raise p-6">
                  <h3 className="mb-4 font-v-display text-lg font-medium tracking-tight text-v-ink">Digital Menu Payload</h3>
                  <div className="space-y-4">
                    <GlassInput
                      label="Menu URL (Required)"
                      value={hubForm.hubMenuUrl}
                      onChange={(v: string) => setHubForm({ ...hubForm, hubMenuUrl: v })}
                      placeholder="https://your-menu.com"
                      icon={<UtensilsCrossed className="w-4 h-4" />}
                    />
                    <div className="v-hairline my-4" />
                    <h3 className="v-t-micro mb-2 text-v-faint">Optional Social Links</h3>
                    <GlassInput label="Instagram URL" value={hubForm.hubInstagramUrl || ""} onChange={(v: string) => setHubForm({ ...hubForm, hubInstagramUrl: v })} icon={<Hash className="w-4 h-4" />} />
                    <GlassInput label="TikTok URL" value={hubForm.hubTiktokUrl || ""} onChange={(v: string) => setHubForm({ ...hubForm, hubTiktokUrl: v })} icon={<Music className="w-4 h-4" />} />
                    <GlassInput label="Facebook URL" value={hubForm.hubFacebookUrl || ""} onChange={(v: string) => setHubForm({ ...hubForm, hubFacebookUrl: v })} icon={<Globe className="w-4 h-4" />} />

                    <div className="v-hairline my-4" />
                    <h3 className="v-t-micro mb-2 text-v-faint">Guest WiFi Info (Optional)</h3>
                    <GlassInput label="Network Name (SSID)" value={hubForm.wifiSsid} onChange={(v: string) => setHubForm({ ...hubForm, wifiSsid: v })} />
                    <GlassInput label="Password" type="text" value={hubForm.wifiPassword} onChange={(v: string) => setHubForm({ ...hubForm, wifiPassword: v })} />
                  </div>

                  <button
                    onClick={saveHubConfig}
                    disabled={isSavingHub}
                    className="v-press mt-6 flex w-full items-center justify-center gap-2 rounded-v bg-v-accent py-4 text-sm font-semibold text-v-accent-ink transition-[filter] hover:brightness-95 disabled:opacity-60">
                    {isSavingHub ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Hub Config"}
                  </button>
                </div>
              </div>
            )}

            {/* ════ MOTION TAB ════ */}
            {activeTab === "motion" && (
              <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
                <div className="relative overflow-hidden rounded-v border border-v-line bg-v-bg-raise">
                  <div className="aspect-square w-full relative flex items-center justify-center p-8 border-b border-v-line">
                    <div className="w-full h-full relative z-10 flex items-center justify-center">
                      <DotLottieReact src={`/animations/${currentAnim.id}`} autoplay loop style={{ width: '80%', height: '80%' }} />
                    </div>
                  </div>
                  <div className="p-6 relative z-10">
                    <div className="v-t-micro mb-2 text-v-faint">Selected Animation</div>
                    <h2 className="mb-4 font-v-display text-2xl font-medium tracking-tight text-v-ink">{currentAnim.label}</h2>

                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => saveAnimation(currentAnim.id)} className={`v-press rounded-v border py-3.5 text-[13px] font-medium transition-colors ${currentAnim.id === savedAnim ? 'border-v-accent/40 text-v-accent' : 'border-v-line text-v-ink hover:bg-white/[0.04]'}`}>
                        {currentAnim.id === savedAnim ? "Currently Active" : "Set Active"}
                      </button>
                      <button onClick={toggleAnimationVisibility} className="v-press flex cursor-pointer items-center justify-between rounded-v border border-v-line px-4 py-3.5 transition-colors hover:bg-white/[0.04]">
                        <span className="text-[13px] font-medium text-v-mut">Play on scan</span>
                        <div className={`h-6 w-10 rounded-full p-[2px] transition-colors duration-300 ease-in-out ${isAnimationVisible ? 'bg-v-accent' : 'border border-v-line bg-white/[0.06]'}`}>
                          <div className={`h-5 w-5 rounded-full transition-transform duration-300 ease-in-out ${isAnimationVisible ? 'translate-x-4 bg-v-accent-ink' : 'translate-x-0 bg-white/50'}`} />
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-5 border-b border-v-line px-1 pb-2">
                    <h2 className="v-t-micro text-v-mut">03 — Library</h2>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {ANIMATIONS.map((anim, idx) => (
                      <div key={anim.id} onClick={() => saveAnimation(anim.id)} className={`group cursor-pointer overflow-hidden rounded-v border transition-colors duration-300 ${carouselIdx === idx ? 'border-v-accent/50 bg-v-accent/[0.05]' : 'border-v-line bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                        <div className="aspect-square bg-transparent p-4 flex justify-center items-center">
                          <DotLottieReact src={`/animations/${anim.id}`} autoplay loop />
                        </div>
                        <div className="flex items-center justify-between border-t border-v-line px-4 pb-4 pt-2">
                          <span className="text-xs font-medium tracking-tight text-v-ink">{anim.label}</span>
                          <ChevronRight className={`w-3 h-3 transition-colors ${carouselIdx === idx ? 'text-v-accent' : 'text-v-faint group-hover:text-v-mut'}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ════ PREVIEW TAB ════ */}
            {activeTab === "preview" && (
              <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-2 flex items-center justify-between border-b border-v-line pb-2">
                  <h2 className="v-t-micro text-v-mut">04 — Hub theme preview</h2>
                </div>
                <p className="-mt-2 text-sm text-v-mut">Select the aesthetic for your digital menu linktree.</p>

                {([
                  {
                    id: "dark", label: "Dark", desc: "Moody espresso — deep blacks, frosted white glass",
                    bg: "https://plus.unsplash.com/premium_photo-1675435644687-562e8042b9db?q=80&w=749&auto=format&fit=crop",
                    overlay: "bg-gradient-to-t from-black via-black/60 to-black/10",
                    imgFilter: "brightness(0.55) saturate(1.1)", badge: "bg-white/8 border-white/12 text-white/50",
                    title: "text-white", pill: "bg-white/10 border-white/15 text-white", activeAccent: "border-v-accent"
                  },
                  {
                    id: "light", label: "Light", desc: "Airy Nordic — cream bloom, glass card, dark text",
                    bg: "https://images.unsplash.com/photo-1669976907613-52f682ca3079?q=80&w=687&auto=format&fit=crop",
                    overlay: "bg-gradient-to-b from-white/55 via-white/10 to-black/40",
                    imgFilter: "brightness(0.78) saturate(0.9)", badge: "bg-black/6 border-black/8 text-zinc-500",
                    title: "text-zinc-900", pill: "bg-white/70 border-black/10 text-zinc-800", activeAccent: "border-v-accent"
                  },
                  {
                    id: "orange", label: "Orange", desc: "Golden-hour — warm amber radial, espresso tones",
                    bg: "https://plus.unsplash.com/premium_photo-1674327105076-36c4419864cf?w=600&auto=format&fit=crop&q=60",
                    overlay: "", imgFilter: "brightness(0.5) saturate(1.4)", badge: "bg-orange-500/15 border-orange-500/30 text-orange-400",
                    title: "text-orange-50", pill: "bg-orange-500/12 border-orange-500/30 text-orange-50", activeAccent: "border-v-accent"
                  },
                ] as const).map((theme) => {
                  const isSelected = hubForm.hubTheme === theme.id;
                  const businessName = hubForm.hubBusinessName || "Your Cafe";
                  const links = [hubForm.hubMenuUrl ? "Menu" : null, hubForm.hubInstagramUrl ? "Instagram" : null].filter(Boolean) as string[];
                  const previewLinks = links.length > 0 ? links : ["Menu", "Instagram"];

                  return (
                    <div key={theme.id} className={`relative cursor-pointer overflow-hidden rounded-v border transition-all duration-300 ${isSelected ? theme.activeAccent : "border-v-line hover:border-white/25"}`} style={{ height: 360 }} onClick={() => { setHubForm({ ...hubForm, hubTheme: theme.id as any }); saveHubConfig(); }}>
                      <img src={theme.bg} alt={theme.label} className="absolute inset-0 w-full h-full object-cover scale-105" style={{ filter: theme.imgFilter }} />
                      {theme.id === "orange" ? <div className="absolute inset-0 z-10" style={{ background: "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(234,88,12,0.35) 0%, transparent 65%), linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.1) 100%)" }} /> : <div className={`absolute inset-0 z-10 ${theme.overlay}`} />}

                      <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-8 px-5">
                        <div className={`text-[8px] uppercase tracking-[0.28em] font-bold px-2 py-0.5 rounded-full border mb-2 ${theme.badge}`}>Voloo Hub</div>
                        <h3 className={`text-xl font-black tracking-tight text-center mb-4 drop-shadow-lg ${theme.title}`}>{businessName}</h3>
                        <div className="w-full max-w-[240px] space-y-2">
                          {previewLinks.map((label) => (
                            <div key={label} className={`w-full flex items-center justify-center py-3 px-5 rounded-xl border backdrop-blur-xl text-[12px] font-bold ${theme.pill}`}>{label}</div>
                          ))}
                        </div>
                      </div>

                      {isSelected && (
                        <div className="v-t-micro absolute top-4 right-4 z-30 flex items-center gap-1.5 rounded-full bg-v-accent px-3 py-1 text-v-accent-ink">
                          <CheckCheck className="w-3 h-3" /> Active
                        </div>
                      )}
                      <div className="absolute bottom-4 left-5 z-30">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">{theme.label}</span>
                        <p className="text-[9px] text-white/35">{theme.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
