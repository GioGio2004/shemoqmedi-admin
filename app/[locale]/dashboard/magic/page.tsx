// magic/page.tsx — placeholder (full implementation commented out below)
export default function MagicPage() {
  return null;
}

// import { api } from "@/convex/_generated/api";
// import { useUser } from "@clerk/nextjs";
// import { useRouter, useParams, useSearchParams } from "next/navigation";
// import { useState, useEffect, useRef } from "react";
// import {
//   Loader2, ArrowLeft, Wifi, User, Coffee, QrCode,
//   Sparkles, MapPin, Clock, Save, Link as LinkIcon,
//   AlertTriangle, Phone, Laugh, CheckCheck, ChevronRight,
//   Info, Play, Zap, UserPlus, Briefcase, Heart,
//   Tag as TagIcon, Pill, Activity, Users, MessageSquare, ArrowUpRight,
//   Plus, Hash, X, CreditCard, Smartphone,
//   Nfc, UtensilsCrossed, Instagram, Music2, Facebook, Store,
//   Gift,
//   Trash2,
// } from "lucide-react";
// import { LanguageSwitcher } from "@/components/LanguageSwitcher";
// import { DotLottieReact } from "@lottiefiles/dotlottie-react";
// import { toast } from "sonner";
// import { useTranslations, useLocale } from "next-intl";
// import { Id } from "@/convex/_generated/dataModel";

// // ─── Animation & Mode Catalogues ─────────────────────────────────────────────
// const ANIMATIONS = [
//   { id: "Be-Bold.lottie", label: "Be Bold" },
//   { id: "Coffee-love.lottie", label: "Coffee Love" },
//   { id: "Gradient Text _ Countdown.lottie", label: "Countdown" },
//   { id: "Linkedin-Career-Celebration-Reaction-Recreated.lottie", label: "Celebrate" },
//   { id: "RUNWAY-logo.lottie", label: "Runway" },
//   { id: "laughing cat.lottie", label: "Laughing Cat" },
//   { id: "Ribbon.lottie", label: "Ribbon" },
// ];

// const MODES = [
//   // { id: "vcard", label: "Socialize", icon: UserPlus, desc: "SHARING ACTIVE", color: "bg-emerald-500/20 text-emerald-500", bg: "", large: false, image: "https://media.istockphoto.com/id/2212432884/photo/diverse-friends-laughing-together-while-sharing-social-media-content-on-cozy-living-room-sofa.jpg?s=1024x1024&w=is&k=20&c=rhG5Dx-rc8FFxEIdSGnNBZyA9kLOEbq6v5dMXDBmO7g=" },
//   // { id: "party", label: "Party", icon: Sparkles, desc: "GET READY", color: "bg-purple-500/20 text-purple-500", bg: "", large: false, image: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1000&auto=format&fit=crop" },
//   // { id: "business", label: "Business", icon: Briefcase, desc: "VCARD PROFILE", color: "bg-blue-500/20 text-blue-500", bg: "", large: false, image: "https://images.unsplash.com/photo-1638262052640-82e94d64664a?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D" },
//   // { id: "custom", label: "Custom", icon: LinkIcon, desc: "REDIRECT ACTIVE", color: "bg-orange-500/20 text-orange-500", bg: "", large: false, image: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1000&auto=format&fit=crop" },
//   { id: "cafe_hub", label: "Cafe Hub", icon: Store, desc: "LINKTREE LANDING", color: "bg-amber-500/20 text-amber-400", bg: "", large: false, image: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?q=80&w=1000&auto=format&fit=crop" },
//   // { id: "dev", label: "Developer", icon: Zap, desc: "Direct SSH links", color: "bg-cyan-500 text-white", bg: "bg-[#162730]", large: true, image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=1000&auto=format&fit=crop" },
// ] as const;

// type ModeId = typeof MODES[number]["id"];

// interface PayloadForm {
//   redirectUrl: string; wifiSsid: string; wifiPassword: string;
//   lostMessage: string; lostContactNumber: string;
//   vcardName: string; vcardPhone: string; vcardEmail: string;
//   vcardCompany: string; vcardTitle: string; vcardNote: string;
// }
// const EMPTY_FORM: PayloadForm = {
//   redirectUrl: "", wifiSsid: "", wifiPassword: "", lostMessage: "", lostContactNumber: "",
//   vcardName: "", vcardPhone: "", vcardEmail: "", vcardCompany: "", vcardTitle: "", vcardNote: "",
// };

// interface HubForm {
//   hubTheme: "dark" | "light" | "orange";
//   hubBusinessName: string;
//   hubMenuUrl: string;
//   hubInstagramUrl: string;
//   hubTiktokUrl: string;
//   hubFacebookUrl: string;
// }
// const EMPTY_HUB: HubForm = {
//   hubTheme: "dark", hubBusinessName: "",
//   hubMenuUrl: "", hubInstagramUrl: "", hubTiktokUrl: "", hubFacebookUrl: "",
// };

// // ─── Reusable Components ──────────────────────────────────────────────────────
// function GlassInput({ label, value, onChange, placeholder, type = "text", icon }: any) {
//   return (
//     <div className="space-y-1.5">
//       <label className="text-[10px] uppercase tracking-wider font-bold text-white/40">{label}</label>
//       <div className="relative">
//         {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30">{icon}</div>}
//         <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
//           // font-size MUST be 16px (text-base) on mobile — iOS Safari zooms in on
//           // any input smaller than 16px and never restores the viewport on blur.
//           style={{ fontSize: "16px" }}
//           className={`w-full bg-white/5 border border-white/10 rounded-xl py-3 text-base text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors ${icon ? "pl-10 pr-4" : "px-4"}`} />
//       </div>
//     </div>
//   );
// }

// // ─── SHADCN-STYLE WIPE & GIFT MODAL ──────────────────────────────────────────
// function WipeTagModal({ isOpen, onClose, onConfirm, isWiping }: { isOpen: boolean; onClose: () => void; onConfirm: () => void; isWiping: boolean }) {
//   const [text, setText] = useState("");

//   useEffect(() => {
//     if (isOpen) setText("");
//   }, [isOpen]);

//   if (!isOpen) return null;

//   const isMatch = text.trim().toUpperCase() === "GIFT TO FRIEND";

//   return (
//     <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
//       <div className="w-full max-w-lg bg-[#09090b] border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-8 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
//         <div className="flex items-center gap-3 mb-4">
//           <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
//             <AlertTriangle className="w-5 h-5 text-red-500" />
//           </div>
//           <h2 className="text-xl font-bold text-white tracking-tight">Wipe & Gift Tag</h2>
//         </div>

//         <p className="text-sm text-white/60 mb-6 leading-relaxed">
//           This action cannot be undone. This will permanently erase your configuration, animations, and VCard data from this physical tag. It will be removed from your account, returning it to a factory state so you can safely gift it to a friend.
//         </p>

//         <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
//           <label className="text-xs font-bold text-white/70 uppercase tracking-widest mb-3 block">
//             Type <span className="text-red-400 select-all font-mono bg-red-500/10 px-1.5 py-0.5 rounded">GIFT TO FRIEND</span> to confirm
//           </label>
//           <input
//             type="text"
//             value={text}
//             onChange={e => setText(e.target.value)}
//             className="w-full bg-black border border-white/10 rounded-lg py-3 px-4 text-white text-sm font-mono focus:outline-none focus:border-red-500 transition-colors"
//             placeholder="GIFT TO FRIEND"
//           />
//         </div>

//         <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-8">
//           <button onClick={onClose} disabled={isWiping} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white/70 hover:bg-white/10 hover:text-white transition-colors">
//             Cancel
//           </button>
//           <button
//             onClick={onConfirm}
//             disabled={!isMatch || isWiping}
//             className="px-5 py-2.5 rounded-xl text-sm font-bold bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:bg-zinc-900 disabled:border-zinc-800 disabled:text-zinc-500 disabled:hover:bg-zinc-900 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
//           >
//             {isWiping ? <Loader2 className="w-4 h-4 animate-spin" /> : "Wipe Tag"}
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// }

// // ─── ADD CARD MODAL ──────────────────────────────────────────────────────────
// function AddCardModal({ isOpen, onClose, initialUuid = "" }: { isOpen: boolean; onClose: () => void; initialUuid?: string }) {
//   const claimTag = useMutation(api.volootags.claimTag);
//   const router = useRouter();
//   const params = useParams();
//   const [phase, setPhase] = useState<"waiting" | "claiming" | "success">("waiting");

//   // 🛡️ Track which UUIDs we are currently processing to prevent double-claiming
//   const processingUuid = useRef<string | null>(null);

//   useEffect(() => {
//     if (initialUuid && isOpen && processingUuid.current !== initialUuid) {
//       handleClaim(initialUuid);
//     } else if (isOpen && !initialUuid) {
//       setPhase("waiting");
//       processingUuid.current = null;
//     }
//   }, [initialUuid, isOpen]);

//   const handleClaim = async (targetUuid: string) => {
//     if (processingUuid.current === targetUuid) return;

//     processingUuid.current = targetUuid;
//     setPhase("claiming");

//     try {
//       await claimTag({ uuid: targetUuid });
//       setPhase("success");

//       // Cleanup after success
//       setTimeout(() => {
//         processingUuid.current = null;
//         onClose();
//         setPhase("waiting");
//         router.replace(`/${params.locale || "ka"}/magic`);
//       }, 2500);
//     } catch (err: any) {
//       // If it fails, allow the user to try again or scan a different tag
//       processingUuid.current = null;
//       toast.error(err.message || "Failed to claim tag.");
//       setPhase("waiting");
//     }
//   };

//   if (!isOpen) return null;

//   return (
//     <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-in fade-in duration-200">
//       <div className="w-full max-w-md bg-[#18181b] border border-white/10 rounded-[32px] overflow-hidden shadow-[0_0_50px_rgba(249,115,22,0.15)] animate-in zoom-in-95 duration-300">
//         <div className="relative p-6 sm:p-8">

//           {phase === "waiting" && (
//             <button onClick={onClose} className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors">
//               <X className="w-5 h-5" />
//             </button>
//           )}

//           {phase === "success" ? (
//             <div className="flex flex-col items-center justify-center py-8 animate-in fade-in zoom-in duration-500">
//               <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border border-emerald-500/30">
//                 <CheckCheck className="w-12 h-12 text-emerald-500" />
//               </div>
//               <h2 className="text-2xl font-black text-white tracking-tight mb-2">Tag Activated!</h2>
//               <p className="text-white/50 text-center text-sm">Your new Voloo Magic Tag has been securely added to your wallet.</p>
//             </div>
//           ) : phase === "claiming" ? (
//             <div className="flex flex-col items-center justify-center py-8 animate-in fade-in duration-300">
//               <Loader2 className="w-16 h-16 text-orange-500 animate-spin mb-6" />
//               <h2 className="text-xl font-black text-white tracking-tight mb-2">Activating Tag...</h2>
//               <p className="text-white/50 text-center text-sm">Binding this tag securely to your account.</p>
//             </div>
//           ) : (
//             <div className="flex flex-col items-center justify-center py-6 animate-in fade-in duration-300">
//               <div className="relative w-24 h-24 mb-8">
//                 <div className="absolute inset-0 border-2 border-orange-500/30 rounded-full animate-ping" style={{ animationDuration: '2s' }} />
//                 <div className="absolute inset-2 border-2 border-orange-500/50 rounded-full animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
//                 <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/20 to-orange-500/5 rounded-full flex items-center justify-center border border-orange-500/30 backdrop-blur-md z-10">
//                   <Smartphone className="w-10 h-10 text-orange-500" />
//                 </div>
//               </div>
//               <h2 className="text-2xl font-black text-white tracking-tight mb-3 text-center">Ready to Scan</h2>
//               <p className="text-sm text-white/50 text-center leading-relaxed px-4">
//                 Hold your new Voloo Magic tag near the top back of your phone to instantly link it to your account.
//               </p>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// }

// // ─── FIRST TAP POPUP ────────────────────────────────────────────────────────
// export function FirstTapActivationPopup() {
//   const { user, isLoaded } = useUser();
//   const locale = useLocale();
//   const router = useRouter();

//   const activeTag = useQuery(api.volootags.getActiveTag, isLoaded && user ? { userId: user.id } : "skip");
//   const clearAlert = useMutation(api.volootags.clearActivationAlert);

//   const [phase, setPhase] = useState<"hidden" | "entering" | "visible" | "exiting">("hidden");
//   const [isSwitching, setIsSwitching] = useState(false);
//   const hasTriggered = useRef(false);

//   useEffect(() => {
//     if (!activeTag || hasTriggered.current) return;
//     if (activeTag.pendingActivationAlert === true) {
//       hasTriggered.current = true;
//       setPhase("entering");
//       const t = setTimeout(() => setPhase("visible"), 20);
//       return () => clearTimeout(t);
//     }
//   }, [activeTag]);

//   const dismiss = async (navigateToMagic = false) => {
//     setPhase("exiting");
//     if (activeTag?._id) {
//       clearAlert({ tagId: activeTag._id as any }).catch(() => { });
//     }
//     await new Promise((r) => setTimeout(r, 420));
//     setPhase("hidden");
//     hasTriggered.current = false;
//     if (navigateToMagic) {
//       router.push(`/${locale}/magic`);
//     }
//   };

//   const handleOpenMagic = async () => {
//     setIsSwitching(true);
//     await dismiss(true);
//   };

//   if (phase === "hidden") return null;

//   const isEntering = phase === "entering" || phase === "visible";

//   return (
//     <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 env(safe-area-inset-bottom, 0px)", background: isEntering ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0)", backdropFilter: isEntering ? "blur(12px)" : "blur(0px)", WebkitBackdropFilter: isEntering ? "blur(12px)" : "blur(0px)", transition: "background 0.4s ease, backdrop-filter 0.4s ease" }} onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
//       <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)", filter: "blur(40px)", pointerEvents: "none", opacity: isEntering ? 1 : 0, transition: "opacity 0.5s ease" }} />
//       <div style={{ width: "100%", maxWidth: 400, background: "#18181b", borderRadius: "28px 28px 0 0", padding: "12px 24px 40px", display: "flex", flexDirection: "column", alignItems: "center", position: "relative", transform: isEntering ? "translateY(0)" : "translateY(100%)", opacity: isEntering ? 1 : 0, transition: "transform 0.55s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease", willChange: "transform", overflow: "hidden" }}>
//         <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", marginBottom: 32, flexShrink: 0 }} />
//         <div style={{ position: "relative", width: 80, height: 80, marginBottom: 28, flexShrink: 0 }}>
//           <div style={{ position: "absolute", inset: 4, borderRadius: 18, border: "1.5px solid rgba(249,115,22,0.45)", animation: `voloo-ring-expand 2.4s ease-out 0s infinite`, pointerEvents: "none" }} />
//           <div style={{ position: "absolute", inset: 4, borderRadius: 18, border: "1.5px solid rgba(249,115,22,0.45)", animation: `voloo-ring-expand 2.4s ease-out 0.8s infinite`, pointerEvents: "none" }} />
//           <div style={{ position: "absolute", inset: 4, borderRadius: 18, border: "1.5px solid rgba(249,115,22,0.45)", animation: `voloo-ring-expand 2.4s ease-out 1.6s infinite`, pointerEvents: "none" }} />
//           <div style={{ position: "absolute", inset: 4, borderRadius: 18, background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.28)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
//             <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="rgb(249,115,22)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>
//           </div>
//         </div>
//         <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(249,115,22,0.9)", background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.18)", borderRadius: 20, padding: "4px 14px", marginBottom: 14 }}>
//           First tap detected ✦
//         </span>
//         <h2 style={{ fontSize: 22, fontWeight: 600, color: "#fff", textAlign: "center", lineHeight: 1.3, marginBottom: 10, letterSpacing: "-0.02em" }}>
//           Your tag is <span style={{ color: "rgb(249,115,22)" }}>live ✦</span>
//         </h2>
//         <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", textAlign: "center", lineHeight: 1.65, marginBottom: 36, maxWidth: 280 }}>
//           Someone just tapped your Voloo Magic tag for the first time. Set your mode and see every connection from your dashboard.
//         </p>
//         <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
//           <button onClick={handleOpenMagic} disabled={isSwitching} style={{ width: "100%", padding: "16px 20px", borderRadius: 16, background: "rgb(249,115,22)", border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: isSwitching ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: isSwitching ? 0.7 : 1, transition: "opacity 0.15s, transform 0.15s", letterSpacing: "0.01em" }} onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)"; }} onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}>
//             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
//             {isSwitching ? "Opening…" : "Open Voloo Magic"}
//             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
//           </button>
//           <button onClick={() => dismiss()} style={{ width: "100%", padding: "14px 20px", borderRadius: 16, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)", fontSize: 14, fontWeight: 400, cursor: "pointer", transition: "background 0.15s" }} onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.09)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}>
//             Maybe later
//           </button>
//         </div>
//         <div style={{ position: "absolute", bottom: 0, left: "20%", right: "20%", height: 1, background: "linear-gradient(to right, transparent, rgba(249,115,22,0.35), transparent)", pointerEvents: "none" }} />
//       </div>
//       <style>{`@keyframes voloo-ring-expand { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(2.4); opacity: 0; } }`}</style>
//     </div>
//   );
// }

// // ─── MAIN MAGIC DASHBOARD ───────────────────────────────────────────────────
// export default function MagicDashboard() {
//   const t = useTranslations("MagicDashboard");
//   const { user, isLoaded } = useUser();
//   const router = useRouter();
//   const params = useParams();
//   const searchParams = useSearchParams();

//   // URL Params & Modals
//   const registerUuid = searchParams.get("register");
//   const [isAddModalOpen, setIsAddModalOpen] = useState(false);
//   const [wipeModalTagId, setWipeModalTagId] = useState<string | null>(null);
//   const [isWiping, setIsWiping] = useState(false);

//   useEffect(() => {
//     if (registerUuid) setIsAddModalOpen(true);
//   }, [registerUuid]);

//   // Queries
//   const allTags = useQuery(api.volootags.getUserTags, { userId: user?.id });
//   const moments = useQuery(api.volootags.getUserMoments, { userId: user?.id }) ?? [];
//   const userProfile = useQuery(api.volootags.getUserProfile, { userId: user?.id });

//   // Mutations
//   const updateTagMode = useMutation(api.volootags.updateTagMode);
//   const toggleAppMode = useMutation(api.volootags.toggleAppMode);
//   const updateTagAnimation = useMutation(api.volootags.updateTagAnimation);
//   const updateMomentNote = useMutation(api.volootags.updateMomentNote);
//   const releaseTag = useMutation(api.volootags.releaseTag);

//   // State
//   const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
//   const [activeTab, setActiveTab] = useState<"wallet" | "tag" | "motion" | "moments">("wallet");

//   const [isSwitching, setIsSwitching] = useState(false);
//   const [savingMode, setSavingMode] = useState<string | null>(null);
//   const [isSavingAnim, setIsSavingAnim] = useState(false);
//   const [isEditingData, setIsEditingData] = useState(false);

//   const [payloadSaved, setPayloadSaved] = useState(false);
//   const [payloadForm, setPayloadForm] = useState<PayloadForm>(EMPTY_FORM);
//   const [isSavingPayload, setIsSavingPayload] = useState(false);

//   // ── Cafe Hub form state ────────────────────────────────────
//   const [hubForm, setHubForm] = useState<HubForm>(EMPTY_HUB);
//   const [isSavingHub, setIsSavingHub] = useState(false);
//   const [hubSaved, setHubSaved] = useState(false);

//   const [carouselIdx, setCarouselIdx] = useState(0);
//   const configRef = useRef<HTMLDivElement>(null);

//   const activeTag = allTags === undefined ? undefined : (
//     allTags.length === 0 ? null : (
//       selectedTagId ? allTags.find(t => t._id === selectedTagId) || allTags[0] : allTags[0]
//     )
//   );

//   // ✅ ADDED THESE 3 MISSING LINES BACK IN!
//   const currentAnim = ANIMATIONS[carouselIdx] || ANIMATIONS[0];
//   const savedAnim = (activeTag as any)?.selectedAnimation || ANIMATIONS[0].id;
//   const isAnimationVisible = activeTag?.showAnimation !== false;

//   useEffect(() => {
//     if (activeTag) {
//       const saved = (activeTag as any).selectedAnimation || ANIMATIONS[0].id;
//       const idx = ANIMATIONS.findIndex(a => a.id === saved);
//       if (idx !== -1) setCarouselIdx(idx);
//     }
//   }, [(activeTag as any)?.selectedAnimation, activeTag?._id]);

//   useEffect(() => {
//     if (activeTag) {
//       const tagData = activeTag as any;
//       const p = userProfile;
//       setPayloadForm({
//         redirectUrl: tagData.redirectUrl || "",
//         wifiSsid: tagData.wifiSsid || "",
//         wifiPassword: tagData.wifiPassword || "",
//         lostMessage: tagData.lostMessage || "",
//         lostContactNumber: tagData.lostContactNumber || "",
//         vcardName: tagData.vcardName || (p ? `${p.name} ${p.lastname}`.trim() : ""),
//         vcardPhone: tagData.vcardPhone || p?.phone || "",
//         vcardEmail: tagData.vcardEmail || p?.email || "",
//         vcardCompany: tagData.vcardCompany || "",
//         vcardTitle: tagData.vcardTitle || "",
//         vcardNote: tagData.vcardNote || "",
//       });
//       setPayloadSaved(false);

//       // Sync hub form from DB
//       setHubForm({
//         hubTheme: tagData.hubTheme || "dark",
//         hubBusinessName: tagData.hubBusinessName || "",
//         hubMenuUrl: tagData.hubMenuUrl || "",
//         hubInstagramUrl: tagData.hubInstagramUrl || "",
//         hubTiktokUrl: tagData.hubTiktokUrl || "",
//         hubFacebookUrl: tagData.hubFacebookUrl || "",
//       });
//       setHubSaved(false);
//     }
//   }, [activeTag?.activeMode, activeTag?._id, userProfile]);

//   const returnToStore = async () => {
//     if (!user) return;
//     setIsSwitching(true);
//     try {
//       await toggleAppMode({ userId: user.id, activeAppMode: "store" });
//       router.push(`/${params.locale || "ka"}`);
//     } catch { setIsSwitching(false); }
//   };

//   const handleModeChange = async (mode: ModeId) => {
//     if (!activeTag) return;
//     setIsEditingData(false);
//     try {
//       await updateTagMode({ tagId: activeTag._id, activeMode: mode });
//       window.scrollTo({ top: 0, behavior: 'smooth' });
//     } catch { toast.error("Failed to switch mode."); }
//   };

//   const handleEditDataToggle = () => {
//     setIsEditingData(!isEditingData);
//     if (!isEditingData) {
//       setTimeout(() => {
//         configRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
//       }, 100);
//     }
//   };

//   const savePayload = async () => {
//     if (!activeTag) return;
//     setIsSavingPayload(true);
//     try {
//       await updateTagMode({
//         tagId: activeTag._id,
//         activeMode: activeTag.activeMode as any,
//         payload: payloadForm,
//       });
//       setPayloadSaved(true);
//       toast.success(t("tag.save_config"));
//       setIsEditingData(false);
//       window.scrollTo({ top: 0, behavior: 'smooth' });
//     } catch {
//       toast.error("Error saving data");
//     } finally {
//       setIsSavingPayload(false);
//     }
//   };

//   const saveHubConfig = async () => {
//     if (!activeTag) return;
//     setIsSavingHub(true);
//     try {
//       await updateTagMode({
//         tagId: activeTag._id,
//         activeMode: "cafe_hub",
//         payload: hubForm,
//       });
//       setHubSaved(true);
//       toast.success("Cafe Hub configuration saved!");
//       setIsEditingData(false);
//       window.scrollTo({ top: 0, behavior: "smooth" });
//     } catch {
//       toast.error("Error saving hub config.");
//     } finally {
//       setIsSavingHub(false);
//     }
//   };

//   const saveAnimation = async (animId: string) => {
//     if (!activeTag) return;
//     setIsSavingAnim(true);
//     try {
//       await updateTagAnimation({
//         tagId: activeTag._id,
//         selectedAnimation: animId
//       });
//       toast.success("Animation updated.");
//     } catch { toast.error("Failed to save."); }
//     finally { setIsSavingAnim(false); }
//   };

//   const toggleAnimationVisibility = async () => {
//     if (!activeTag) return;
//     try {
//       await updateTagAnimation({
//         tagId: activeTag._id,
//         showAnimation: !isAnimationVisible
//       });
//       toast.success(isAnimationVisible ? "Animation disabled on scan." : "Animation enabled on scan.");
//     } catch {
//       toast.error("Failed to update visibility.");
//     }
//   };

//   const handleConfirmWipe = async () => {
//     if (!wipeModalTagId) return;
//     setIsWiping(true);
//     try {
//       await releaseTag({ tagId: wipeModalTagId as Id<"volootags"> });
//       toast.success("Tag wiped and removed from wallet!");
//       setWipeModalTagId(null);
//       if (selectedTagId === wipeModalTagId) {
//         setSelectedTagId(null);
//         setActiveTab("wallet");
//       }
//     } catch (e) {
//       toast.error("Failed to remove card.");
//     } finally {
//       setIsWiping(false);
//     }
//   };

//   if (!isLoaded || allTags === undefined) {
//     return (
//       <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center">
//         <Loader2 className="w-8 h-8 animate-spin text-foreground mb-4" />
//       </div>
//     );
//   }

//   const activeModeDetails = activeTag ? MODES.find((m) => m.id === activeTag.activeMode) || MODES[0] : MODES[0];

//   return (
//     <div className="min-h-[100dvh] bg-[#111111] text-foreground flex flex-col font-sans selection:bg-primary/30">

//       {/* ── MODALS ── */}
//       <FirstTapActivationPopup />
//       <AddCardModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} initialUuid={registerUuid || ""} />
//       <WipeTagModal
//         isOpen={wipeModalTagId !== null}
//         onClose={() => setWipeModalTagId(null)}
//         onConfirm={handleConfirmWipe}
//         isWiping={isWiping}
//       />

//       {/* ── DESKTOP TOP NAV / HEADER ── */}
//       <div className="sticky top-0 z-40 bg-[#161616]/90 backdrop-blur-xl border-b border-white/5 flex-shrink-0">
//         <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
//           <button onClick={returnToStore} disabled={isSwitching} className="p-2 -ml-2 text-white/50 hover:text-white transition-colors flex items-center gap-2">
//             {isSwitching ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowLeft className="w-5 h-5" />}
//           </button>

//           <div className="flex font-black tracking-widest text-lg items-center gap-1">
//             VOLOO
//           </div>

//           <div className="flex items-center gap-2">
//             <LanguageSwitcher />
//             <button onClick={() => setIsAddModalOpen(true)} className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors" title="Add New Tag">
//               <Plus className="w-4 h-4 text-white" />
//             </button>
//             <Activity className="w-5 h-5 text-white/50 ml-1" />
//           </div>
//         </div>
//       </div>

//       {/* ── FOOTER TAB NAV (MOBILE) ── */}
//       <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#151515] border-t border-white/5 pb-[env(safe-area-inset-bottom,0px)]">
//         <div className="max-w-2xl mx-auto px-2 py-2 flex items-center justify-between">
//           {[
//             { id: "wallet", label: "My Cards", icon: CreditCard },
//             { id: "tag", label: t("tabs.tag"), icon: TagIcon },
//             { id: "motion", label: t("tabs.motion"), icon: Pill },
//             { id: "moments", label: "Hub Preview", icon: Store },
//           ].map((tab) => {
//             const isActive = activeTab === tab.id;
//             const Icon = tab.icon;

//             if ((tab.id === "tag" || tab.id === "motion") && activeTab === "wallet" && !selectedTagId) return null;

//             return (
//               <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
//                 className="flex-1 flex flex-col items-center justify-center gap-1.5 py-1 transition-all group">
//                 <div className={`w-12 h-8 rounded-full flex items-center justify-center transition-all ${isActive ? 'bg-white/10' : 'group-hover:bg-white/5'}`}>
//                   <Icon className={`w-5 h-5 transition-colors ${isActive ? 'text-white' : 'text-white/40 group-hover:text-white/70'}`} />
//                 </div>
//                 <span className={`text-[9px] font-black tracking-widest transition-colors uppercase ${isActive ? 'text-white' : 'text-white/40'}`}>
//                   {tab.label}
//                 </span>
//               </button>
//             );
//           })}
//         </div>
//       </div>

//       {/* ── MAIN LAYOUT ── */}
//       <div className="flex-1 overflow-hidden flex max-w-5xl mx-auto w-full">
//         {/* DESKTOP SIDEBAR */}
//         <div className="hidden md:flex flex-col w-56 pt-8 pr-6 border-r border-white/5 mr-6 h-full overflow-y-auto">
//           <div className="space-y-2">
//             {[
//               { id: "wallet", label: "My Cards", icon: CreditCard },
//               { id: "tag", label: t("tabs.tag"), icon: TagIcon },
//               { id: "motion", label: t("tabs.motion"), icon: Pill },
//               { id: "moments", label: "Hub Preview", icon: Store },
//             ].map((tab) => {
//               const isActive = activeTab === tab.id;
//               const Icon = tab.icon;
//               return (
//                 <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
//                   className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold tracking-wide
//                     ${isActive ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5 hover:text-white/70'}`}>
//                   <Icon className="w-5 h-5" />
//                   {tab.label}
//                 </button>
//               );
//             })}
//           </div>
//         </div>

//         {/* SCROLLABLE CONTENT */}
//         <div className="flex-1 overflow-y-auto pb-28 md:pb-8">
//           <div className="max-w-2xl mx-auto px-4 lg:px-0 py-8 space-y-6">

//             {/* ════ WALLET TAB (List of all cards) ════ */}
//             {activeTab === "wallet" && (
//               <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
//                 <div className="flex items-center justify-between mb-2">
//                   <h2 className="text-2xl font-black text-white tracking-tight">Your Cards</h2>
//                   <span className="text-xs font-bold text-white/40 bg-white/5 px-3 py-1 rounded-full">{allTags.length} Active</span>
//                 </div>

//                 {allTags.length === 0 ? (
//                   <div className="text-center py-16 px-6 bg-[#171717] border border-white/5 rounded-3xl">
//                     <div className="w-16 h-16 mx-auto bg-white/5 rounded-full flex items-center justify-center mb-4">
//                       <Nfc className="w-8 h-8 text-white/30" />
//                     </div>
//                     <h3 className="text-lg font-bold text-white mb-2">No Tags Yet</h3>
//                     <p className="text-sm text-white/50 mb-6">You haven't activated any Voloo Magic Tags.</p>
//                     <button onClick={() => setIsAddModalOpen(true)} className="bg-orange-500 text-white px-6 py-3 rounded-full text-sm font-bold tracking-wide hover:bg-orange-600 transition-colors">
//                       Add Your First Tag
//                     </button>
//                   </div>
//                 ) : (
//                   <div className="grid gap-4">
//                     {allTags.map((tag: any, i) => {
//                       const mode = MODES.find(m => m.id === tag.activeMode) || MODES[0];
//                       const Icon = mode.icon;
//                       return (
//                         <div key={tag._id} className="relative w-full bg-zinc-900 border border-white/10 rounded-[28px] overflow-hidden group hover:border-orange-500/50 transition-colors shadow-lg flex flex-col">
//                           {/* Backgrounds */}
//                           <div className="absolute inset-0 opacity-20 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url('${mode.image}')` }} />
//                           <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/40 pointer-events-none" />

//                           {/* Clickable Card Body (Opens Editor) */}
//                           <button onClick={() => { setSelectedTagId(tag._id); setActiveTab("tag"); }} className="relative z-10 p-6 text-left w-full flex items-center justify-between outline-none">
//                             <div className="flex items-center gap-4">
//                               <div className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-white/10 backdrop-blur-md border border-white/10`}>
//                                 <Icon className="w-5 h-5 text-white" />
//                               </div>
//                               <div>
//                                 <h3 className="text-lg font-bold text-white tracking-tight">Voloo Tag {i + 1}</h3>
//                                 <p className="text-[10px] font-black uppercase tracking-widest text-orange-400 mt-1">Mode: {mode.label}</p>
//                               </div>
//                             </div>
//                             <ChevronRight className="w-5 h-5 text-white/30 group-hover:text-white transition-colors" />
//                           </button>

//                           {/* Action Footer (Wipe & Gift) */}
//                           <div className="relative z-10 px-6 py-4 bg-black/40 border-t border-white/5 flex items-center justify-between">
//                             <div className="flex flex-col">
//                               <span className="text-[10px] font-mono text-white/40">{tag.volooTagsUUID.slice(0, 15)}...</span>
//                               <span className="text-[10px] font-bold text-white/30 mt-0.5">{tag.tapCount || 0} Total Taps</span>
//                             </div>
//                             <button
//                               onClick={(e) => { e.stopPropagation(); setWipeModalTagId(tag._id); }}
//                               className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-white/60 hover:text-red-400 rounded-full transition-colors text-[10px] font-bold uppercase tracking-widest"
//                             >
//                               <Gift className="w-3.5 h-3.5" /> Wipe & Gift
//                             </button>
//                           </div>
//                         </div>
//                       );
//                     })}
//                   </div>
//                 )}
//               </div>
//             )}

//             {/* ════ TAG TAB (Editor) ════ */}
//             {activeTab === "tag" && activeTag && (
//               <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">

//                 <button onClick={() => { setSelectedTagId(null); setActiveTab("wallet"); }} className="flex items-center gap-2 text-sm font-bold text-white/50 hover:text-white transition-colors mb-2">
//                   <ArrowLeft className="w-4 h-4" /> Back to Wallet
//                 </button>

//                 {/* HERO BANNER (Dynamic Background) */}
//                 <div
//                   className="relative w-full aspect-[4/5] sm:aspect-video rounded-3xl overflow-hidden bg-zinc-900 border border-white/5 shadow-2xl flex flex-col justify-end p-6 group transition-all duration-700"
//                 >
//                   <div
//                     className="absolute inset-0 opacity-40 bg-cover bg-center blend-screen mix-blend-screen transition-all duration-700"
//                     style={{ backgroundImage: `url('${activeModeDetails.image}')` }}
//                   />
//                   <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/80 to-transparent" />
//                   <div className={`absolute top-0 left-0 w-full h-full ${activeModeDetails.bg || ''} opacity-20`} />

//                   <div className="relative z-10 flex flex-col gap-3">
//                     <div className="flex justify-between items-start w-full">
//                       <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full">
//                         <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
//                         <span className="text-[10px] font-bold tracking-widest uppercase text-white/90">{t("tag.live_now")}</span>
//                       </div>

//                       {/* WIPE MODAL TRIGGER IN EDITOR */}
//                       <button onClick={() => setWipeModalTagId(activeTag._id)} className="w-8 h-8 bg-red-500/10 border border-red-500/20 text-red-500 rounded-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors" title="Wipe and Gift this Tag">
//                         <Trash2 className="w-4 h-4" />
//                       </button>
//                     </div>

//                     <h1 className="text-4xl font-black text-white tracking-tight drop-shadow-lg">{t("tag.title")}</h1>
//                     <p className="text-sm text-white/70 font-medium leading-relaxed max-w-[280px]">
//                       {t("tag.broadcasting", { mode: activeModeDetails.label })}
//                     </p>
//                     <button
//                       onClick={handleEditDataToggle}
//                       className={`mt-2 w-full sm:w-auto bg-white/10 hover:bg-white/20 backdrop-blur-md border px-5 py-3.5 rounded-xl font-bold tracking-wide text-sm flex items-center justify-center gap-2 transition-all ${isEditingData ? 'border-orange-500 text-orange-400' : 'border-white/10 text-white'}`}>
//                       {t("tag.edit_data")} <ArrowUpRight className={`w-4 h-4 ml-1 transition-transform ${isEditingData ? 'rotate-90' : ''}`} />
//                     </button>
//                   </div>
//                 </div>

//                 {/* CONFIGURATION FORM */}
//                 {isEditingData && (
//                   <div ref={configRef} className="bg-[#171717] border border-white/10 rounded-3xl p-6 animate-in slide-in-from-top-4 fade-in duration-300">
//                     <h3 className="text-lg font-black text-white mb-4 tracking-tight">{t("tag.config_title")} - {activeModeDetails.label}</h3>
//                     <div className="space-y-4">
//                       {/* Render inputs based on active mode */}
//                       {["vcard", "business"].includes(activeTag.activeMode) && (
//                         <>
//                           <GlassInput label="Name" value={payloadForm.vcardName} onChange={(v: string) => setPayloadForm({ ...payloadForm, vcardName: v })} icon={<User />} />
//                           <GlassInput label="Phone" value={payloadForm.vcardPhone} onChange={(v: string) => setPayloadForm({ ...payloadForm, vcardPhone: v })} icon={<Phone />} />
//                           <GlassInput label="Email" value={payloadForm.vcardEmail} onChange={(v: string) => setPayloadForm({ ...payloadForm, vcardEmail: v })} />
//                           <GlassInput label="Company" value={payloadForm.vcardCompany} onChange={(v: string) => setPayloadForm({ ...payloadForm, vcardCompany: v })} />
//                         </>
//                       )}
//                       {activeTag.activeMode === "wifi" && (
//                         <>
//                           <GlassInput label="Network Name (SSID)" value={payloadForm.wifiSsid} onChange={(v: string) => setPayloadForm({ ...payloadForm, wifiSsid: v })} icon={<Wifi />} />
//                           <GlassInput label="Password" type="password" value={payloadForm.wifiPassword} onChange={(v: string) => setPayloadForm({ ...payloadForm, wifiPassword: v })} />
//                         </>
//                       )}
//                       {activeTag.activeMode === "lost" && (
//                         <>
//                           <GlassInput label="Lost Message" value={payloadForm.lostMessage} onChange={(v: string) => setPayloadForm({ ...payloadForm, lostMessage: v })} placeholder="Please return to owner" icon={<AlertTriangle />} />
//                           <GlassInput label="Contact Number" value={payloadForm.lostContactNumber} onChange={(v: string) => setPayloadForm({ ...payloadForm, lostContactNumber: v })} icon={<Phone />} />
//                         </>
//                       )}
//                       {["custom", "dating", "dev", "party", "meme", "coffee"].includes(activeTag.activeMode) && (
//                         <GlassInput label="Redirect URL" value={payloadForm.redirectUrl} onChange={(v: string) => setPayloadForm({ ...payloadForm, redirectUrl: v })} placeholder="https://..." icon={<LinkIcon />} />
//                       )}

//                       {/* ── CAFE HUB CONFIG ── */}
//                       {activeTag.activeMode === "cafe_hub" && (
//                         <div className="space-y-5">
//                           {/* Theme selector */}
//                           {/* <div className="space-y-2">
//                             <p className="text-[10px] uppercase tracking-wider font-bold text-white/40">Hub Theme</p>
//                             <div className="grid grid-cols-3 gap-2">
//                               {([
//                                 { value: "dark",   label: "Dark",   preview: "bg-black border-zinc-800" },
//                                 { value: "light",  label: "Light",  preview: "bg-white border-zinc-200" },
//                                 { value: "orange", label: "Orange", preview: "bg-zinc-950 border-orange-800" },
//                               ] as const).map((theme) => (
//                                 <button
//                                   key={theme.value}
//                                   type="button"
//                                   onClick={() => setHubForm({ ...hubForm, hubTheme: theme.value })}
//                                   className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all
//                                     ${hubForm.hubTheme === theme.value
//                                       ? "border-white/50 bg-white/10"
//                                       : "border-white/10 bg-white/5 hover:border-white/25"}`}
//                                 >
//                                   <div className={`w-10 h-6 rounded-lg border ${theme.preview}`} />
//                                   <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">{theme.label}</span>
//                                   {hubForm.hubTheme === theme.value && (
//                                     <div className="w-1.5 h-1.5 rounded-full bg-white" />
//                                   )}
//                                 </button>
//                               ))}
//                             </div>
//                           </div> */}

//                           {/* Fields */}
//                           <GlassInput
//                             label="Business Name"
//                             value={hubForm.hubBusinessName}
//                             onChange={(v: string) => setHubForm({ ...hubForm, hubBusinessName: v })}
//                             placeholder="e.g. Fabrika Coffee"
//                             icon={<Store className="w-4 h-4" />}
//                           />
//                           <GlassInput
//                             label="Menu URL"
//                             value={hubForm.hubMenuUrl}
//                             onChange={(v: string) => setHubForm({ ...hubForm, hubMenuUrl: v })}
//                             placeholder="https://your-menu.com"
//                             icon={<UtensilsCrossed className="w-4 h-4" />}
//                           />
//                           <GlassInput
//                             label="Instagram URL"
//                             value={hubForm.hubInstagramUrl}
//                             onChange={(v: string) => setHubForm({ ...hubForm, hubInstagramUrl: v })}
//                             placeholder="https://instagram.com/yourhandle"
//                             icon={<Instagram className="w-4 h-4" />}
//                           />
//                           <GlassInput
//                             label="TikTok URL"
//                             value={hubForm.hubTiktokUrl}
//                             onChange={(v: string) => setHubForm({ ...hubForm, hubTiktokUrl: v })}
//                             placeholder="https://tiktok.com/@yourhandle"
//                             icon={<Music2 className="w-4 h-4" />}
//                           />
//                           <GlassInput
//                             label="Facebook URL"
//                             value={hubForm.hubFacebookUrl}
//                             onChange={(v: string) => setHubForm({ ...hubForm, hubFacebookUrl: v })}
//                             placeholder="https://facebook.com/yourpage"
//                             icon={<Facebook className="w-4 h-4" />}
//                           />
//                         </div>
//                       )}

//                       {activeTag.activeMode === "cafe_hub" ? (
//                         <button
//                           onClick={saveHubConfig}
//                           disabled={isSavingHub}
//                           className="w-full bg-amber-500 text-black py-4 rounded-xl text-sm font-black uppercase tracking-widest mt-4 hover:bg-amber-400 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
//                           {isSavingHub ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Store className="w-4 h-4" /> Save Hub Config</>}
//                         </button>
//                       ) : (
//                         <button
//                           onClick={savePayload}
//                           disabled={isSavingPayload}
//                           className="w-full bg-white text-black py-4 rounded-xl text-sm font-black uppercase tracking-widest mt-4 hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center">
//                           {isSavingPayload ? <Loader2 className="w-5 h-5 animate-spin" /> : t("tag.save_config")}
//                         </button>
//                       )}
//                     </div>
//                   </div>
//                 )}

//                 {/* ════ MODES LIST — commented out, only Cafe Hub is active ════
//                 <div className="space-y-4">
//                   <div className="flex items-center justify-between px-1">
//                     <h2 className="text-lg font-black tracking-tight text-white">{t("tag.available_modes")}</h2>
//                     <span className="text-[11px] text-white/40 tracking-wider font-semibold uppercase">{t("tag.profiles_active", { count: MODES.length })}</span>
//                   </div>

//                   <div className="grid grid-cols-1 gap-3">
//                     {MODES.map((mode) => {
//                       const isActive = activeTag.activeMode === mode.id;
//                       const Icon = mode.icon;
//                       ... (mode cards JSX preserved but hidden)
//                     })}
//                   </div>
//                 </div>
//                 ════ END MODES LIST ════ */}

//                 {/* STATISTICS */}
//                 <div className="grid grid-cols-1 gap-3">
//                   <div className="bg-[#171717] border border-white/5 rounded-3xl p-5 flex flex-col justify-center h-[120px]">
//                     <h4 className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2">{t("tag.scan_activity")}</h4>
//                     <div className="flex items-baseline gap-3">
//                       <span className="text-4xl font-black tracking-tighter text-white">{activeTag.tapCount || 0}</span>
//                       <span className="text-[11px] font-bold text-emerald-500 tracking-wider">Total Taps</span>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* ════ MOTION TAB ════ */}
//             {activeTab === "motion" && activeTag && (
//               <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">

//                 {/* CURRENT MOTION HERO (Apple Glassy Effect) */}
//                 <div className="relative rounded-[32px] overflow-hidden border border-white/20 bg-white/10 backdrop-blur-3xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
//                   {/* Subtle lighting orb behind the glass */}
//                   <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-500/20 rounded-full blur-[80px] pointer-events-none" />

//                   <div className="aspect-square w-full bg-black/20 relative flex items-center justify-center p-8 border-b border-white/10">
//                     <div className="w-full h-full relative z-10 flex items-center justify-center drop-shadow-2xl">
//                       <DotLottieReact src={`/animations/${currentAnim.id}`} autoplay loop style={{ width: '80%', height: '80%' }} />
//                     </div>
//                   </div>
//                   <div className="p-6 relative z-10">
//                     <div className="text-[10px] uppercase font-bold tracking-widest text-white/50 mb-2">
//                       {t("motion.active_motion")}
//                     </div>
//                     <h2 className="text-2xl font-black text-white tracking-tight mb-4 drop-shadow-md">
//                       {currentAnim.label}
//                     </h2>
//                     <p className="text-sm text-white/70 leading-relaxed mb-6">
//                       {t("motion.desc")}
//                     </p>

//                     <div className="grid grid-cols-2 gap-3">
//                       <button
//                         onClick={() => saveAnimation(currentAnim.id)}
//                         className="bg-white/10 backdrop-blur-md border border-white/20 text-white py-3.5 rounded-2xl text-[13px] font-bold hover:bg-white/20 transition-all shadow-lg flex items-center justify-center gap-2"
//                       >
//                         {currentAnim.id === savedAnim ? t("motion.already_active") : t("motion.set_active")}
//                       </button>

//                       {/* NEW: Animation On/Off Toggle */}
//                       <button
//                         onClick={toggleAnimationVisibility}
//                         className="bg-white/10 backdrop-blur-md border border-white/20 text-white py-3.5 rounded-2xl flex items-center justify-between px-4 hover:bg-white/20 transition-all shadow-lg cursor-pointer"
//                       >
//                         <span className="text-[13px] font-bold text-white/90">
//                           {t("motion.show_animation")}
//                         </span>

//                         {/* iOS Style Switch */}
//                         <div className={`w-10 h-6 rounded-full p-[2px] transition-colors duration-300 ease-in-out ${isAnimationVisible ? 'bg-emerald-500' : 'bg-black/40 border border-white/10'}`}>
//                           <div className={`w-5 h-5 rounded-full shadow-md transition-transform duration-300 ease-in-out ${isAnimationVisible ? 'translate-x-4 bg-white' : 'translate-x-0 bg-white/50'}`} />
//                         </div>
//                       </button>
//                     </div>
//                   </div>
//                 </div>

//                 {/* MOTION LIBRARY (Glassy Cards) */}
//                 <div>
//                   <div className="flex items-center justify-between mb-5 px-1">
//                     <div>
//                       <div className="text-[10px] font-bold tracking-widest text-white/40 uppercase mb-1">{t("motion.library")}</div>
//                       <h2 className="text-2xl font-black text-white tracking-tight">{t("motion.library")}</h2>
//                     </div>
//                     <span className="text-xs font-bold text-white underline underline-offset-4 cursor-pointer hover:text-white/80">{t("motion.view_all")}</span>
//                   </div>

//                   <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
//                     {ANIMATIONS.map((anim, idx) => (
//                       <div key={anim.id} onClick={() => saveAnimation(anim.id)}
//                         className={`group cursor-pointer rounded-3xl overflow-hidden border transition-all duration-300 backdrop-blur-xl shadow-lg
//                         ${carouselIdx === idx ? 'border-emerald-500/50 bg-emerald-500/10 shadow-emerald-500/20' : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'}`}>
//                         <div className="aspect-square bg-transparent p-4 flex justify-center items-center drop-shadow-xl">
//                           <DotLottieReact src={`/animations/${anim.id}`} autoplay loop />
//                         </div>
//                         <div className="px-4 pb-4 pt-2 flex items-center justify-between border-t border-white/5">
//                           <span className="text-xs font-bold text-white tracking-tight">{anim.label}</span>
//                           <ChevronRight className={`w-3 h-3 transition-colors ${carouselIdx === idx ? 'text-emerald-400' : 'text-white/30 group-hover:text-white/70'}`} />
//                         </div>
//                       </div>
//                     ))}
//                   </div>
//                 </div>
//               </div>
//             )}

//             {/* ════ CAFE HUB PREVIEW TAB ════ */}
//             {activeTab === "moments" && (
//               <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
//                 <div className="flex items-center justify-between mb-2">
//                   <h2 className="text-2xl font-black text-white tracking-tight">Hub Preview</h2>
//                   <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full uppercase tracking-widest">Live Themes</span>
//                 </div>
//                 <p className="text-sm text-white/40 -mt-2">
//                   This is exactly how your Cafe Hub will appear when a customer taps your tag.
//                 </p>

//                 {/* ── THEME PREVIEW CARDS ── */}
//                 {([
//                   {
//                     id: "dark",
//                     label: "Dark",
//                     desc: "Moody espresso — deep blacks, frosted white glass",
//                     bg: "https://plus.unsplash.com/premium_photo-1675435644687-562e8042b9db?q=80&w=749&auto=format&fit=crop",
//                     overlay: "bg-gradient-to-t from-black via-black/60 to-black/10",
//                     imgFilter: "brightness(0.55) saturate(1.1)",
//                     badge: "bg-white/8 border-white/12 text-white/50",
//                     title: "text-white",
//                     pill: "bg-white/10 border-white/15 text-white",
//                     footer: "text-white/20",
//                     activeAccent: "border-white/50",
//                   },
//                   {
//                     id: "light",
//                     label: "Light",
//                     desc: "Airy Nordic — cream bloom, glass card, dark text",
//                     bg: "https://images.unsplash.com/photo-1669976907613-52f682ca3079?q=80&w=687&auto=format&fit=crop",
//                     overlay: "bg-gradient-to-b from-white/55 via-white/10 to-black/40",
//                     imgFilter: "brightness(0.78) saturate(0.9)",
//                     badge: "bg-black/6 border-black/8 text-zinc-500",
//                     title: "text-zinc-900",
//                     pill: "bg-white/70 border-black/10 text-zinc-800",
//                     footer: "text-zinc-400",
//                     activeAccent: "border-zinc-300",
//                   },
//                   {
//                     id: "orange",
//                     label: "Orange",
//                     desc: "Golden-hour — warm amber radial, espresso tones",
//                     bg: "https://plus.unsplash.com/premium_photo-1674327105076-36c4419864cf?w=600&auto=format&fit=crop&q=60",
//                     overlay: "",
//                     imgFilter: "brightness(0.5) saturate(1.4)",
//                     badge: "bg-orange-500/15 border-orange-500/30 text-orange-400",
//                     title: "text-orange-50",
//                     pill: "bg-orange-500/12 border-orange-500/30 text-orange-50",
//                     footer: "text-orange-900/60",
//                     activeAccent: "border-orange-500",
//                   },
//                 ] as const).map((theme) => {
//                   const isSelected = (activeTag as any)?.hubTheme === theme.id || (!((activeTag as any)?.hubTheme) && theme.id === "dark");
//                   const businessName = (activeTag as any)?.hubBusinessName || "Your Cafe";
//                   const links = [
//                     (activeTag as any)?.hubMenuUrl ? "Menu" : null,
//                     (activeTag as any)?.hubInstagramUrl ? "Instagram" : null,
//                     (activeTag as any)?.hubTiktokUrl ? "TikTok" : null,
//                     (activeTag as any)?.hubFacebookUrl ? "Facebook" : null,
//                   ].filter(Boolean) as string[];
//                   const previewLinks = links.length > 0 ? links : ["Menu", "Instagram", "TikTok"];

//                   return (
//                     <div
//                       key={theme.id}
//                       className={`relative rounded-[28px] overflow-hidden border-2 transition-all duration-300 cursor-pointer
//                         ${isSelected ? theme.activeAccent + " shadow-lg" : "border-white/8 hover:border-white/20"}`}
//                       style={{ height: 360 }}
//                       onClick={() => { if (activeTag) { updateTagMode({ tagId: activeTag._id, activeMode: "cafe_hub", payload: { hubTheme: theme.id as any } }); toast.success(`Theme switched to ${theme.label}.`); } }}
//                     >
//                       {/* Bg image */}
//                       <img
//                         src={theme.bg}
//                         alt={theme.label}
//                         className="absolute inset-0 w-full h-full object-cover scale-105"
//                         style={{ filter: theme.imgFilter }}
//                       />

//                       {/* Overlay */}
//                       {theme.id === "orange" ? (
//                         <div className="absolute inset-0 z-10" style={{ background: "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(234,88,12,0.35) 0%, transparent 65%), linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.1) 100%)" }} />
//                       ) : (
//                         <div className={`absolute inset-0 z-10 ${theme.overlay}`} />
//                       )}

//                       {/* Content */}
//                       <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-8 px-5">
//                         <div className={`text-[8px] uppercase tracking-[0.28em] font-bold px-2 py-0.5 rounded-full border mb-2 ${theme.badge}`}>Voloo Magic</div>
//                         <h3 className={`text-xl font-black tracking-tight text-center mb-4 drop-shadow-lg ${theme.title}`}>{businessName}</h3>
//                         <div className="w-full max-w-[240px] space-y-2">
//                           {previewLinks.map((label) => (
//                             <div key={label} className={`w-full flex items-center justify-center py-3 px-5 rounded-xl border backdrop-blur-xl text-[12px] font-bold ${theme.pill}`}>
//                               {label}
//                             </div>
//                           ))}
//                         </div>
//                       </div>

//                       {/* Active badge */}
//                       {isSelected && (
//                         <div className="absolute top-4 right-4 z-30 bg-white text-black text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-lg flex items-center gap-1.5">
//                           <CheckCheck className="w-3 h-3" /> Active
//                         </div>
//                       )}

//                       {/* Theme label at bottom-left */}
//                       <div className="absolute bottom-4 left-5 z-30">
//                         <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">{theme.label}</span>
//                         <p className="text-[9px] text-white/35">{theme.desc}</p>
//                       </div>
//                     </div>
//                   );
//                 })}
//               </div>
//             )}

//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }