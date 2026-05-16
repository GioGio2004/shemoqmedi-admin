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
      <label className="text-[10px] uppercase tracking-wider font-bold text-white/40">{label}</label>
      <div className="relative">
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30">{icon}</div>}
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          style={{ fontSize: "16px" }}
          className={`w-full bg-white/5 border border-white/10 rounded-xl py-3 text-base text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors ${icon ? "pl-10 pr-4" : "px-4"}`} />
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
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-foreground mb-4" />
      </div>
    );
  }

  const totalTaps = (allTags ?? []).reduce((s: number, t: any) => s + (t.tapCount ?? 0), 0);
  const activeTags = (allTags ?? []).filter((t: any) => t.isActive).length;

  return (
    <div className="min-h-[100dvh] bg-[#111111] text-foreground flex flex-col font-sans selection:bg-primary/30">
      <Toaster position="bottom-right" theme="dark" richColors />

      {/* ── DESKTOP TOP NAV / HEADER ── */}
      <div className="sticky top-0 z-40 bg-[#161616]/90 backdrop-blur-xl border-b border-white/5 flex-shrink-0">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex font-black tracking-widest text-lg items-center gap-2">
            <Nfc className="w-5 h-5 text-emerald-500" />
            NFC FLEET
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Activity className="w-5 h-5 text-white/50 ml-1" />
          </div>
        </div>
      </div>

      {/* ── FOOTER TAB NAV (MOBILE) ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#151515] border-t border-white/5 pb-[env(safe-area-inset-bottom,0px)]">
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
                className="flex-1 flex flex-col items-center justify-center gap-1.5 py-1 transition-all group">
                <div className={`w-12 h-8 rounded-full flex items-center justify-center transition-all ${isActive ? 'bg-white/10' : 'group-hover:bg-white/5'}`}>
                  <Icon className={`w-5 h-5 transition-colors ${isActive ? 'text-white' : 'text-white/40 group-hover:text-white/70'}`} />
                </div>
                <span className={`text-[9px] font-black tracking-widest transition-colors uppercase ${isActive ? 'text-white' : 'text-white/40'}`}>
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
        <div className="hidden md:flex flex-col w-56 pt-8 pr-6 border-r border-white/5 mr-6 h-full overflow-y-auto">
          <div className="space-y-2">
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
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold tracking-wide
                    ${isActive ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5 hover:text-white/70'}`}>
                  <Icon className="w-5 h-5" />
                  {tab.label}
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
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-2xl font-black text-white tracking-tight">Active Chips</h2>
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full">{activeTags} Active</span>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-[#171717] border border-white/5 rounded-3xl p-5 flex flex-col justify-center">
                    <h4 className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Total Assigned</h4>
                    <span className="text-3xl font-black tracking-tighter text-white">{allTags.length}</span>
                  </div>
                  <div className="bg-[#171717] border border-white/5 rounded-3xl p-5 flex flex-col justify-center">
                    <h4 className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Fleet Taps</h4>
                    <span className="text-3xl font-black tracking-tighter text-white">{totalTaps}</span>
                  </div>
                </div>

                {allTags.length === 0 ? (
                  <div className="text-center py-16 px-6 bg-[#171717] border border-white/5 rounded-3xl">
                    <div className="w-16 h-16 mx-auto bg-white/5 rounded-full flex items-center justify-center mb-4">
                      <Nfc className="w-8 h-8 text-white/30" />
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">No Chips Assigned</h3>
                    <p className="text-sm text-white/50">Contact Shemoqmedi to provision hardware for your cafe.</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {allTags.map((tag: any, i: number) => {
                      const isEditing = editingTableId === tag._id;
                      const tapUrl = typeof window !== "undefined" ? `${window.location.origin}/t/${tag.volooTagsUUID}` : `/t/${tag.volooTagsUUID}`;

                      return (
                        <div key={tag._id} className="relative w-full bg-[#171717] border border-white/10 rounded-[24px] overflow-hidden group hover:border-emerald-500/30 transition-colors shadow-lg">
                          <div className="p-5 flex flex-col gap-3">
                            {/* Header */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${tag.isActive ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
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
                                        className="bg-black border border-white/10 rounded px-2 py-1 text-sm text-white w-32 outline-none focus:border-white/30"
                                      />
                                      <button onClick={() => saveTableRename(tag._id)} className="text-emerald-400 hover:text-emerald-300"><CheckCheck className="w-4 h-4" /></button>
                                      <button onClick={() => setEditingTableId(null)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 group/edit cursor-pointer" onClick={() => { setEditingTableId(tag._id); setEditTableName(tag.tableName || ""); }}>
                                      <h3 className="text-lg font-bold text-white tracking-tight">{tag.tableName || `Chip ${i + 1}`}</h3>
                                      <Edit3 className="w-3 h-3 text-white/20 group-hover/edit:text-white/80 transition-colors" />
                                    </div>
                                  )}
                                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/80 mt-0.5">
                                    {tag.tapCount} Taps
                                  </p>
                                </div>
                              </div>
                              <span className="text-[10px] uppercase font-bold text-white/30 bg-black/50 px-2 py-1 rounded-lg">
                                {tag.isActive ? "Online" : "Offline"}
                              </span>
                            </div>

                            {/* UUID & Tap Info */}
                            <div className="pt-3 border-t border-white/5 flex flex-col gap-2">
                              <div className="flex items-center gap-2 bg-black/40 px-3 py-2 rounded-xl">
                                <span className="text-[10px] uppercase text-white/40 font-bold shrink-0">UUID</span>
                                <code className="text-xs font-mono text-white/70 flex-1 truncate">{tag.volooTagsUUID}</code>
                                <button onClick={() => { navigator.clipboard.writeText(tag.volooTagsUUID); toast.success("UUID Copied"); }} className="text-white/30 hover:text-white"><Copy className="w-3.5 h-3.5" /></button>
                              </div>
                              <div className="flex items-center gap-2 px-1">
                                <a href={tapUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 hover:underline flex items-center gap-1">
                                  Test Tap <ExternalLink className="w-3 h-3" />
                                </a>
                                <span className="text-white/20">•</span>
                                <button onClick={() => window.open(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=png&margin=12&data=${encodeURIComponent(tapUrl)}`, "_blank")} className="text-xs text-white/50 hover:text-white flex items-center gap-1">
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
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-2xl font-black text-white tracking-tight">Hub Settings</h2>
                  <span className="text-[10px] font-bold text-white/40 bg-white/5 px-3 py-1 rounded-full uppercase tracking-widest">Global Profile</span>
                </div>

                <div className="bg-[#171717] border border-white/10 rounded-3xl p-6">
                  <h3 className="text-lg font-black text-white mb-4 tracking-tight">Digital Menu Payload</h3>
                  <div className="space-y-4">
                    <GlassInput
                      label="Menu URL (Required)"
                      value={hubForm.hubMenuUrl}
                      onChange={(v: string) => setHubForm({ ...hubForm, hubMenuUrl: v })}
                      placeholder="https://your-menu.com"
                      icon={<UtensilsCrossed className="w-4 h-4" />}
                    />
                    <div className="h-px bg-white/5 my-4" />
                    <h3 className="text-[10px] font-black text-white/40 mb-2 uppercase tracking-widest">Optional Social Links</h3>
                    <GlassInput label="Instagram URL" value={hubForm.hubInstagramUrl || ""} onChange={(v: string) => setHubForm({ ...hubForm, hubInstagramUrl: v })} icon={<Hash className="w-4 h-4" />} />
                    <GlassInput label="TikTok URL" value={hubForm.hubTiktokUrl || ""} onChange={(v: string) => setHubForm({ ...hubForm, hubTiktokUrl: v })} icon={<Music className="w-4 h-4" />} />
                    <GlassInput label="Facebook URL" value={hubForm.hubFacebookUrl || ""} onChange={(v: string) => setHubForm({ ...hubForm, hubFacebookUrl: v })} icon={<Globe className="w-4 h-4" />} />

                    <div className="h-px bg-white/5 my-4" />
                    <h3 className="text-[10px] font-black text-white/40 mb-2 uppercase tracking-widest">Guest WiFi Info (Optional)</h3>
                    <GlassInput label="Network Name (SSID)" value={hubForm.wifiSsid} onChange={(v: string) => setHubForm({ ...hubForm, wifiSsid: v })} />
                    <GlassInput label="Password" type="text" value={hubForm.wifiPassword} onChange={(v: string) => setHubForm({ ...hubForm, wifiPassword: v })} />
                  </div>

                  <button
                    onClick={saveHubConfig}
                    disabled={isSavingHub}
                    className="w-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 py-4 rounded-xl text-sm font-black uppercase tracking-widest mt-6 hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center gap-2">
                    {isSavingHub ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Hub Config"}
                  </button>
                </div>
              </div>
            )}

            {/* ════ MOTION TAB ════ */}
            {activeTab === "motion" && (
              <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
                <div className="relative rounded-[32px] overflow-hidden border border-white/20 bg-white/10 backdrop-blur-3xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
                  <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-500/20 rounded-full blur-[80px] pointer-events-none" />
                  <div className="aspect-square w-full bg-black/20 relative flex items-center justify-center p-8 border-b border-white/10">
                    <div className="w-full h-full relative z-10 flex items-center justify-center drop-shadow-2xl">
                      <DotLottieReact src={`/animations/${currentAnim.id}`} autoplay loop style={{ width: '80%', height: '80%' }} />
                    </div>
                  </div>
                  <div className="p-6 relative z-10">
                    <div className="text-[10px] uppercase font-bold tracking-widest text-white/50 mb-2">Selected Animation</div>
                    <h2 className="text-2xl font-black text-white tracking-tight mb-4 drop-shadow-md">{currentAnim.label}</h2>

                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => saveAnimation(currentAnim.id)} className="bg-white/10 backdrop-blur-md border border-white/20 text-white py-3.5 rounded-2xl text-[13px] font-bold hover:bg-white/20 transition-all shadow-lg">
                        {currentAnim.id === savedAnim ? "Currently Active" : "Set Active"}
                      </button>
                      <button onClick={toggleAnimationVisibility} className="bg-white/10 backdrop-blur-md border border-white/20 text-white py-3.5 rounded-2xl flex items-center justify-between px-4 hover:bg-white/20 transition-all shadow-lg cursor-pointer">
                        <span className="text-[13px] font-bold text-white/90">Play on scan</span>
                        <div className={`w-10 h-6 rounded-full p-[2px] transition-colors duration-300 ease-in-out ${isAnimationVisible ? 'bg-emerald-500' : 'bg-black/40 border border-white/10'}`}>
                          <div className={`w-5 h-5 rounded-full shadow-md transition-transform duration-300 ease-in-out ${isAnimationVisible ? 'translate-x-4 bg-white' : 'translate-x-0 bg-white/50'}`} />
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight mb-5 px-1">Library</h2>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {ANIMATIONS.map((anim, idx) => (
                      <div key={anim.id} onClick={() => saveAnimation(anim.id)} className={`group cursor-pointer rounded-3xl overflow-hidden border transition-all duration-300 backdrop-blur-xl shadow-lg ${carouselIdx === idx ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 bg-white/5 hover:border-white/30'}`}>
                        <div className="aspect-square bg-transparent p-4 flex justify-center items-center drop-shadow-xl">
                          <DotLottieReact src={`/animations/${anim.id}`} autoplay loop />
                        </div>
                        <div className="px-4 pb-4 pt-2 flex items-center justify-between border-t border-white/5">
                          <span className="text-xs font-bold text-white tracking-tight">{anim.label}</span>
                          <ChevronRight className={`w-3 h-3 transition-colors ${carouselIdx === idx ? 'text-emerald-400' : 'text-white/30 group-hover:text-white/70'}`} />
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
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-2xl font-black text-white tracking-tight">Hub Theme Preview</h2>
                </div>
                <p className="text-sm text-white/40 -mt-2">Select the aesthetic for your digital menu linktree.</p>

                {([
                  {
                    id: "dark", label: "Dark", desc: "Moody espresso — deep blacks, frosted white glass",
                    bg: "https://plus.unsplash.com/premium_photo-1675435644687-562e8042b9db?q=80&w=749&auto=format&fit=crop",
                    overlay: "bg-gradient-to-t from-black via-black/60 to-black/10",
                    imgFilter: "brightness(0.55) saturate(1.1)", badge: "bg-white/8 border-white/12 text-white/50",
                    title: "text-white", pill: "bg-white/10 border-white/15 text-white", activeAccent: "border-emerald-500/50"
                  },
                  {
                    id: "light", label: "Light", desc: "Airy Nordic — cream bloom, glass card, dark text",
                    bg: "https://images.unsplash.com/photo-1669976907613-52f682ca3079?q=80&w=687&auto=format&fit=crop",
                    overlay: "bg-gradient-to-b from-white/55 via-white/10 to-black/40",
                    imgFilter: "brightness(0.78) saturate(0.9)", badge: "bg-black/6 border-black/8 text-zinc-500",
                    title: "text-zinc-900", pill: "bg-white/70 border-black/10 text-zinc-800", activeAccent: "border-zinc-300"
                  },
                  {
                    id: "orange", label: "Orange", desc: "Golden-hour — warm amber radial, espresso tones",
                    bg: "https://plus.unsplash.com/premium_photo-1674327105076-36c4419864cf?w=600&auto=format&fit=crop&q=60",
                    overlay: "", imgFilter: "brightness(0.5) saturate(1.4)", badge: "bg-orange-500/15 border-orange-500/30 text-orange-400",
                    title: "text-orange-50", pill: "bg-orange-500/12 border-orange-500/30 text-orange-50", activeAccent: "border-emerald-500/50"
                  },
                ] as const).map((theme) => {
                  const isSelected = hubForm.hubTheme === theme.id;
                  const businessName = hubForm.hubBusinessName || "Your Cafe";
                  const links = [hubForm.hubMenuUrl ? "Menu" : null, hubForm.hubInstagramUrl ? "Instagram" : null].filter(Boolean) as string[];
                  const previewLinks = links.length > 0 ? links : ["Menu", "Instagram"];

                  return (
                    <div key={theme.id} className={`relative rounded-[28px] overflow-hidden border-2 transition-all duration-300 cursor-pointer ${isSelected ? theme.activeAccent + " shadow-lg" : "border-white/8 hover:border-white/20"}`} style={{ height: 360 }} onClick={() => { setHubForm({ ...hubForm, hubTheme: theme.id as any }); saveHubConfig(); }}>
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
                        <div className="absolute top-4 right-4 z-30 bg-emerald-500 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-lg flex items-center gap-1.5">
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
