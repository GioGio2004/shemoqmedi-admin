"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useOrganization } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  DEFAULT_STUDIO_CONFIG,
  type StudioConfig,
} from "@/convex/studioConfig";
import { cn } from "@/lib/utils";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Eye,
  HelpCircle,
  Layers,
  Loader2,
  MessageSquare,
  Monitor,
  Palette,
  RefreshCw,
  Rocket,
  Smartphone,
  Store,
  TriangleAlert,
  Type,
} from "lucide-react";
import { bestInkFor } from "../_studio/presets";
import {
  MenuPreview,
  type PreviewViewport,
} from "../_studio/MenuPreview";
import { LiveFrame } from "../_studio/LiveFrame";
import {
  CardsPanel,
  HeroPanel,
  MotionPanel,
  NavPanel,
  SectionsPanel,
  ThemePanel,
} from "../_studio/StudioPanels";
import {
  ContentPanel,
  VenuePanel,
  toRecord,
  type Announcement,
  type OperatingHour,
  type SocialLinksContent,
  type StorefrontContent,
} from "./ContentPanels";
import {
  ChatPanel,
  ChatPhonePreview,
  DEFAULT_CHAT_THEME,
  type BgTemplate,
  type ChatThemeState,
} from "./ChatPanel";
import { StudioTutorial, STUDIO_FLOW, type TutorialApply } from "./Tutorial";

// ─────────────────────────────────────────────────────────────────────────────
// The Storefront workspace — Studio design + storefront content merged into
// one full-screen glass editor. Managers land on their own venue; anyone with
// several venues gets a switcher. Everything autosaves; Publish pushes the
// design draft live.
// ─────────────────────────────────────────────────────────────────────────────

type Section = "design" | "content" | "venue" | "chat";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const SECTIONS: Array<{ key: Section; label: string; icon: React.ElementType }> = [
  { key: "design", label: "Design", icon: Palette },
  { key: "content", label: "Content", icon: Type },
  { key: "venue", label: "Venue", icon: Store },
  { key: "chat", label: "Chat", icon: MessageSquare },
];

// Menu template + ruled settings were EXTRACTED to /dashboard/templates —
// this state deliberately excludes them so the two surfaces never overwrite
// each other (updateStorefrontConfig only patches the keys it receives).
interface ContentState {
  storefront: StorefrontContent;
  hours: OperatingHour[];
  socials: SocialLinksContent;
  announcements: Announcement[];
  lat?: number;
  lng?: number;
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** ContentState → updateStorefrontConfig args (shared by autosave + flush). */
function buildContentArgs(orgId: string, content: ContentState) {
  return {
    orgId,
    storefrontConfig: {
      heroHeadline: content.storefront.heroHeadline,
      heroSubheadline: content.storefront.heroSubheadline,
      primaryButtonText: content.storefront.primaryButtonText,
      secondaryButtonText: content.storefront.secondaryButtonText,
      coverImageUrl: content.storefront.coverImageUrl || undefined,
      heroImageUrls: content.storefront.heroImageUrls,
      address: content.storefront.address,
      cityStateZip: content.storefront.cityStateZip,
    },
    operatingHours: content.hours,
    socialLinks: {
      whatsapp: content.socials.whatsapp || undefined,
      instagram: content.socials.instagram || undefined,
      email: content.socials.email || undefined,
    },
    announcements: content.announcements,
  };
}

/** ChatThemeState → aiChatThemes.update args. */
function buildChatArgs(
  orgId: string,
  chat: ChatThemeState,
  existing: { botAvatarUrl?: string; fontFamily?: string } | null | undefined,
) {
  return {
    orgId,
    botName: chat.botName || undefined,
    botAvatarUrl: existing?.botAvatarUrl,
    primaryColor: chat.primaryColor,
    primaryColorLight: chat.primaryColorLight || undefined,
    backgroundColor: chat.backgroundColor,
    textColor: chat.textColor,
    userMessageBg: chat.userBubbleBg,
    userMessageText: chat.userBubbleText,
    botMessageBg: chat.botBubbleBg,
    botMessageText: chat.botBubbleText,
    fontFamily: existing?.fontFamily ?? "Inter",
    backgroundTemplate:
      chat.backgroundTemplate === "none" ? undefined : chat.backgroundTemplate,
    greetingMessage: chat.greetingMessage || undefined,
    isActive: chat.isActive,
  };
}

// ── Entry: resolve which venue this session edits ────────────────────────────
export function WorkspaceClient() {
  const { organization, isLoaded } = useOrganization();
  // Best practice: never fire authed queries before the Clerk token reaches
  // Convex — unguarded mounts spam "Unauthenticated" errors in the logs.
  const { isAuthenticated } = useConvexAuth();
  const myOrgs = useQuery(
    api.studio.listOrganizations,
    isAuthenticated ? {} : "skip",
  );
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const orgId =
    selectedOrgId ?? organization?.id ?? myOrgs?.[0]?.clerkId ?? null;

  if (!isLoaded || (myOrgs === undefined && !organization)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-v-faint" />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Store className="h-8 w-8 text-v-faint" />
        <p className="font-medium text-v-ink">No venue to design</p>
        <p className="max-w-xs text-sm text-v-mut">
          Select a workspace first, then open the Storefront studio.
        </p>
        <Link
          href="/dashboard"
          className="v-t-micro mt-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-v-mut backdrop-blur transition-colors hover:text-v-ink"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <WorkspaceEditor
      key={orgId}
      orgId={orgId}
      orgs={myOrgs ?? []}
      onSwitchOrg={setSelectedOrgId}
    />
  );
}

// ── The editor itself, remounted per venue ───────────────────────────────────
function WorkspaceEditor({
  orgId,
  orgs,
  onSwitchOrg,
}: {
  orgId: string;
  orgs: Array<{ clerkId: string; name: string }>;
  onSwitchOrg: (id: string) => void;
}) {
  const locale = useLocale();
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(
    api.studio.getStudioData,
    isAuthenticated ? { orgId } : "skip",
  );
  const chatRow = useQuery(
    api.aiChatThemes.get,
    isAuthenticated ? { orgId } : "skip",
  );
  const onboardingRow = useQuery(
    api.onboarding.getMine,
    isAuthenticated ? { flow: STUDIO_FLOW } : "skip",
  );
  const saveDraft = useMutation(api.studio.saveDraft);
  const publishDesign = useMutation(api.studio.publish);
  const saveContent = useMutation(api.organizations.updateStorefrontConfig);
  const saveLocation = useMutation(api.venues.updateLocation);
  const saveChatTheme = useMutation(api.aiChatThemes.update);

  const [section, setSection] = useState<Section>("design");
  const [mobileView, setMobileView] = useState<"panels" | "preview">("panels");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [viewport, setViewport] = useState<PreviewViewport>("phone");
  const [previewMode, setPreviewMode] = useState<"live" | "draft">("live");
  const [liveReloadKey, setLiveReloadKey] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const [publishing, setPublishing] = useState(false);

  // Tutorial visibility — derived, no effects: eligible until finished/skipped.
  const [tourDismissed, setTourDismissed] = useState(false);
  const [tourManual, setTourManual] = useState(false);
  const tourEligible =
    onboardingRow !== undefined &&
    (onboardingRow === null ||
      (!onboardingRow.completedAt && !onboardingRow.skippedAt));
  const tourOpen = tourManual || (tourEligible && !tourDismissed);

  // ── DESIGN domain (draft → publish) ───────────────────────────────────────
  const [designEdits, setDesignEdits] = useState<StudioConfig | null>(null);
  const designInitial = useMemo<StudioConfig | null>(() => {
    if (!data) return null;
    if (data.draft) return data.draft;
    const accent = data.org.accentColor;
    const validAccent =
      accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent) ? accent : null;
    return validAccent
      ? {
          ...DEFAULT_STUDIO_CONFIG,
          theme: {
            ...DEFAULT_STUDIO_CONFIG.theme,
            accent: validAccent,
            accentInk: bestInkFor(validAccent),
          },
        }
      : DEFAULT_STUDIO_CONFIG;
  }, [data]);
  const design = designEdits ?? designInitial;
  const patchDesign = (p: Partial<StudioConfig>) =>
    setDesignEdits((prev) => {
      const base = prev ?? designInitial;
      return base ? { ...base, ...p } : prev;
    });

  const [designSave, setDesignSave] = useState<SaveState>("idle");
  const designSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!design) return;
    const json = JSON.stringify(design);
    if (designEdits === null) {
      designSavedRef.current = json;
      return;
    }
    if (json === designSavedRef.current) return;
    setDesignSave("dirty");
    const timer = setTimeout(async () => {
      try {
        setDesignSave("saving");
        await saveDraft({ orgId, config: design });
        designSavedRef.current = json;
        setDesignSave("saved");
      } catch {
        setDesignSave("error");
        toast.error("Design draft failed to save.");
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [design, designEdits, orgId, saveDraft]);

  // ── CONTENT domain (live on save) ─────────────────────────────────────────
  const [contentEdits, setContentEdits] = useState<ContentState | null>(null);
  const contentInitial = useMemo<ContentState | null>(() => {
    if (!data) return null;
    const sc = data.org.storefrontConfig;
    const heroImages = [...(sc?.heroImageUrls ?? [])];
    while (heroImages.length < 3) heroImages.push("");
    return {
      storefront: {
        heroHeadline: toRecord(sc?.heroHeadline),
        heroSubheadline: toRecord(sc?.heroSubheadline),
        primaryButtonText: toRecord(sc?.primaryButtonText),
        secondaryButtonText: toRecord(sc?.secondaryButtonText),
        coverImageUrl: sc?.coverImageUrl ?? "",
        heroImageUrls: heroImages.slice(0, 3) as [string, string, string],
        address: toRecord(sc?.address),
        cityStateZip: toRecord(sc?.cityStateZip),
      },
      hours: data.org.operatingHours ?? [
        { day: "Mon – Fri", hours: "08:00 – 20:00" },
        { day: "Sat – Sun", hours: "09:00 – 18:00" },
      ],
      socials: {
        whatsapp: data.org.socialLinks?.whatsapp ?? "",
        instagram: data.org.socialLinks?.instagram ?? "",
        email: data.org.socialLinks?.email ?? "",
      },
      announcements: data.org.announcements ?? [],
      lat: data.org.venueLat ?? undefined,
      lng: data.org.venueLng ?? undefined,
    };
  }, [data]);
  const content = contentEdits ?? contentInitial;
  const patchContent = (p: Partial<ContentState>) =>
    setContentEdits((prev) => {
      const base = prev ?? contentInitial;
      return base ? { ...base, ...p } : prev;
    });

  const [contentSave, setContentSave] = useState<SaveState>("idle");
  const contentSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!content) return;
    const json = JSON.stringify(content);
    if (contentEdits === null) {
      contentSavedRef.current = json;
      return;
    }
    if (json === contentSavedRef.current) return;
    setContentSave("dirty");
    const timer = setTimeout(async () => {
      try {
        setContentSave("saving");
        await saveContent(buildContentArgs(orgId, content));
        if (content.lat !== undefined && content.lng !== undefined) {
          await saveLocation({ orgId, lat: content.lat, lng: content.lng });
        }
        contentSavedRef.current = json;
        setContentSave("saved");
        // Live preview is the real page — refresh it so the save shows up.
        setLiveReloadKey((k) => k + 1);
      } catch {
        setContentSave("error");
        toast.error("Content failed to save — check your connection.");
      }
    }, 3500);
    return () => clearTimeout(timer);
  }, [content, contentEdits, orgId, saveContent, saveLocation]);

  // ── CHAT domain (VolooAI widget theme — live on save) ─────────────────────
  const [chatEdits, setChatEdits] = useState<ChatThemeState | null>(null);
  const chatInitial = useMemo<ChatThemeState | null>(() => {
    if (chatRow === undefined) return null;
    if (!chatRow) return DEFAULT_CHAT_THEME;
    return {
      botName: chatRow.botName ?? "",
      greetingMessage:
        chatRow.greetingMessage ?? DEFAULT_CHAT_THEME.greetingMessage,
      primaryColor: chatRow.primaryColor || DEFAULT_CHAT_THEME.primaryColor,
      primaryColorLight:
        chatRow.primaryColorLight ??
        chatRow.primaryColor ??
        DEFAULT_CHAT_THEME.primaryColorLight,
      backgroundColor:
        chatRow.backgroundColor || DEFAULT_CHAT_THEME.backgroundColor,
      textColor: chatRow.textColor || DEFAULT_CHAT_THEME.textColor,
      userBubbleBg: chatRow.userMessageBg || DEFAULT_CHAT_THEME.userBubbleBg,
      userBubbleText:
        chatRow.userMessageText || DEFAULT_CHAT_THEME.userBubbleText,
      botBubbleBg: chatRow.botMessageBg || DEFAULT_CHAT_THEME.botBubbleBg,
      botBubbleText:
        chatRow.botMessageText || DEFAULT_CHAT_THEME.botBubbleText,
      backgroundTemplate: (chatRow.backgroundTemplate ??
        "none") as BgTemplate,
      isActive: chatRow.isActive ?? true,
    };
  }, [chatRow]);
  const chat = chatEdits ?? chatInitial;

  const [chatSave, setChatSave] = useState<SaveState>("idle");
  const chatSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chat) return;
    const json = JSON.stringify(chat);
    if (chatEdits === null) {
      chatSavedRef.current = json;
      return;
    }
    if (json === chatSavedRef.current) return;
    setChatSave("dirty");
    const timer = setTimeout(async () => {
      try {
        setChatSave("saving");
        await saveChatTheme(buildChatArgs(orgId, chat, chatRow));
        chatSavedRef.current = json;
        setChatSave("saved");
      } catch {
        setChatSave("error");
        toast.error("Chat theme failed to save.");
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [chat, chatEdits, orgId, saveChatTheme, chatRow]);

  // ── Combined status + unload guard ────────────────────────────────────────
  const busy =
    designSave === "saving" || contentSave === "saving" || chatSave === "saving";
  const dirty =
    designSave === "dirty" || contentSave === "dirty" || chatSave === "dirty";
  const failed =
    designSave === "error" || contentSave === "error" || chatSave === "error";
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (busy || dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy, dirty]);

  // ── Flush pending edits when the editor unmounts (venue switch, back
  //    navigation). Convex finishes fire-and-forget requests after unmount. ──
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = () => {
      // Marks the state as saved before firing so the still-scheduled
      // debounce timer no-ops instead of double-writing.
      if (design) {
        const json = JSON.stringify(design);
        if (json !== designSavedRef.current) {
          designSavedRef.current = json;
          saveDraft({ orgId, config: design }).catch(() => {});
        }
      }
      if (content) {
        const json = JSON.stringify(content);
        if (json !== contentSavedRef.current) {
          contentSavedRef.current = json;
          saveContent(buildContentArgs(orgId, content)).catch(() => {});
          if (content.lat !== undefined && content.lng !== undefined) {
            saveLocation({ orgId, lat: content.lat, lng: content.lng }).catch(
              () => {},
            );
          }
        }
      }
      if (chat) {
        const json = JSON.stringify(chat);
        if (json !== chatSavedRef.current) {
          chatSavedRef.current = json;
          saveChatTheme(buildChatArgs(orgId, chat, chatRow)).catch(() => {});
        }
      }
    };
  });
  useEffect(() => () => flushRef.current(), []);

  // Leaving a section flushes its pending edits immediately — one write now
  // beats a timer racing navigation.
  const switchSection = (key: Section) => {
    flushRef.current();
    setSection(key);
  };

  const handlePublish = async () => {
    if (!design) return;
    try {
      setPublishing(true);
      await publishDesign({ orgId, config: design });
      designSavedRef.current = JSON.stringify(design);
      setDesignSave("saved");
      toast.success("Design published — the live menu picks it up instantly.");
    } catch {
      toast.error("Publish failed. Try again.");
    } finally {
      setPublishing(false);
    }
  };

  const hasUnpublishedChanges = useMemo(() => {
    if (!design) return false;
    return JSON.stringify(design) !== JSON.stringify(data?.published ?? null);
  }, [design, data?.published]);

  // ── Loading / missing ─────────────────────────────────────────────────────
  if (data === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-v-ink">This venue no longer exists.</p>
        <Link href="/dashboard" className="v-t-micro rounded-xl border border-white/10 px-4 py-2 text-v-mut hover:text-v-ink">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (data === undefined || !design || !content || !chat) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-v-faint" />
      </div>
    );
  }

  const previewOrg = {
    name: data.org.name,
    slug: data.org.slug,
    logoUrl: data.org.logoUrl,
    coverImageUrl: content.storefront.coverImageUrl || data.org.coverImageUrl,
    tagline: content.storefront.heroSubheadline,
    operatingHours: content.hours,
    socialLinks: {
      whatsapp: content.socials.whatsapp || undefined,
      instagram: content.socials.instagram || undefined,
      email: content.socials.email || undefined,
    },
  };

  const saveBadge = failed ? (
    <span className="v-t-micro flex items-center gap-1.5 text-red-400">
      <TriangleAlert className="h-3 w-3" /> Save failed
    </span>
  ) : busy ? (
    <span className="v-t-micro flex items-center gap-1.5 text-v-mut">
      <Loader2 className="h-3 w-3 animate-spin" /> Saving
    </span>
  ) : dirty ? (
    <span className="v-t-micro flex items-center gap-1.5 text-v-mut">
      <span className="h-1.5 w-1.5 rounded-full bg-v-accent" /> Unsaved
    </span>
  ) : designSave === "saved" || contentSave === "saved" ? (
    <span className="v-t-micro flex items-center gap-1.5 text-v-faint">
      <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Saved
    </span>
  ) : null;

  const panelContent = (
    <>
      {section === "design" && (
        <>
          <ThemePanel config={design} patch={patchDesign} />
          <CardsPanel config={design} patch={patchDesign} />
          <HeroPanel config={design} patch={patchDesign} />
          <NavPanel config={design} patch={patchDesign} />
          <MotionPanel
            config={design}
            patch={patchDesign}
            onReplay={() => {
              setReplayKey((k) => k + 1);
              setMobileView("preview");
            }}
          />
          <SectionsPanel config={design} patch={patchDesign} />
          <div className="px-3 pb-2">
            <Link
              href="/dashboard/templates"
              className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-xl transition-colors hover:bg-white/[0.08]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/25">
                <Layers className="h-3.5 w-3.5 text-v-accent" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-v-ink">
                  Menu templates
                </span>
                <span className="block text-[10px] text-v-faint">
                  Ready-made looks moved to their own page
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-v-faint" />
            </Link>
          </div>
          <p className="v-t-micro px-5 pb-5 text-v-faint">
            Design saves as a draft — press Publish to push it live.
          </p>
        </>
      )}
      {section === "content" && (
        <>
          <ContentPanel
            storefront={content.storefront}
            onStorefront={(s) => patchContent({ storefront: s })}
            lat={content.lat}
            lng={content.lng}
            onLocation={(lat, lng) => patchContent({ lat, lng })}
            cafeName={data.org.name}
          />
          <p className="v-t-micro px-5 pb-5 text-v-faint">
            Content saves live — visitors see it on their next open.
          </p>
        </>
      )}
      {section === "venue" && (
        <VenuePanel
          hours={content.hours}
          onHours={(h) => patchContent({ hours: h })}
          socials={content.socials}
          onSocials={(s) => patchContent({ socials: s })}
          announcements={content.announcements}
          onAnnouncements={(a) => patchContent({ announcements: a })}
        />
      )}
      {section === "chat" && (
        <>
          <ChatPanel
            chat={chat}
            onChat={setChatEdits}
            venueName={data.org.name}
          />
          <p className="v-t-micro px-5 pb-5 text-v-faint">
            Chat theme saves live — the widget restyles on the next menu open.
          </p>
        </>
      )}
    </>
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden text-v-ink">
      <Toaster position="bottom-right" theme="dark" />

      {/* ── Ambient backdrop the glass refracts ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] rounded-full bg-v-accent/[0.06] blur-[140px]" />
        <div className="absolute -right-32 bottom-0 h-[26rem] w-[26rem] rounded-full bg-[#8F7BFF]/[0.07] blur-[140px]" />
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(244,243,240,0.05) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      {/* ── Top glass bar ── */}
      <header className="relative z-20 mx-3 mt-3 flex h-14 shrink-0 items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.06] px-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-2xl sm:gap-3 sm:px-3">
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-v-mut transition-colors hover:text-v-ink"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex min-w-0 items-center gap-2.5">
          {data.org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.org.logoUrl}
              alt=""
              className="hidden h-8 w-8 shrink-0 rounded-lg border border-white/10 object-cover sm:block"
            />
          ) : null}
          <div className="min-w-0">
            {orgs.length > 1 ? (
              <div className="relative">
                <select
                  value={orgId}
                  onChange={(e) => onSwitchOrg(e.target.value)}
                  className="w-full max-w-[160px] cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-medium text-v-ink outline-none [color-scheme:dark] sm:max-w-[220px]"
                  aria-label="Switch venue"
                >
                  {orgs.map((o) => (
                    <option key={o.clerkId} value={o.clerkId} className="bg-zinc-900">
                      {o.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-v-faint" />
              </div>
            ) : (
              <p className="truncate text-sm font-medium leading-none text-v-ink">
                {data.org.name}
              </p>
            )}
            <p className="v-t-micro mt-0.5 truncate text-v-faint">
              storefront studio
            </p>
          </div>
        </div>

        {/* preview source: the real menu page vs the design draft */}
        <div className="ml-auto hidden items-center gap-1 rounded-xl border border-white/[0.08] bg-black/25 p-1 md:flex">
          <button
            type="button"
            onClick={() => setPreviewMode("live")}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[11px] transition-all",
              previewMode === "live"
                ? "bg-white/90 font-semibold text-black shadow-sm"
                : "text-v-mut hover:text-v-ink",
            )}
          >
            Live
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode("draft")}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[11px] transition-all",
              previewMode === "draft"
                ? "bg-white/90 font-semibold text-black shadow-sm"
                : "text-v-mut hover:text-v-ink",
            )}
          >
            Draft
          </button>
        </div>

        {/* viewport toggle */}
        <div className="hidden items-center gap-1 rounded-xl border border-white/[0.08] bg-black/25 p-1 md:flex">
          <button
            type="button"
            onClick={() => setViewport("phone")}
            aria-label="Phone preview"
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] transition-all",
              viewport === "phone"
                ? "bg-white/90 font-semibold text-black shadow-sm"
                : "text-v-mut hover:text-v-ink",
            )}
          >
            <Smartphone className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewport("desktop")}
            aria-label="Desktop preview"
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] transition-all",
              viewport === "desktop"
                ? "bg-white/90 font-semibold text-black shadow-sm"
                : "text-v-mut hover:text-v-ink",
            )}
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
        </div>

        {previewMode === "live" && (
          <button
            type="button"
            onClick={() => setLiveReloadKey((k) => k + 1)}
            aria-label="Reload live preview"
            title="Reload live preview"
            className="hidden h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-v-mut transition-colors hover:text-v-ink md:flex"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setTourManual(true)}
          aria-label="Open the tour"
          title="Take the tour again"
          className="hidden h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-v-mut transition-colors hover:text-v-ink sm:flex"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>

        <div className="flex items-center gap-2.5">
          <span className="hidden sm:block">{saveBadge}</span>
          {data.publishedAt && !hasUnpublishedChanges ? (
            <span className="v-t-micro hidden items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-2.5 py-1 text-emerald-300 lg:flex">
              <span className="h-1 w-1 rounded-full bg-emerald-400" />
              Live · {timeAgo(data.publishedAt)}
            </span>
          ) : data.publishedAt && hasUnpublishedChanges ? (
            <span className="v-t-micro hidden items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-2.5 py-1 text-amber-300 lg:flex">
              <CloudUpload className="h-3 w-3" /> Unpublished
            </span>
          ) : null}
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing}
            className="flex items-center gap-2 rounded-xl bg-v-accent px-3.5 py-2 text-xs font-semibold text-v-accent-ink shadow-[0_4px_20px_rgba(216,255,58,0.25)] transition-all hover:brightness-95 disabled:opacity-60"
          >
            {publishing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Publish</span>
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="relative z-10 flex min-h-0 flex-1">
        {/* Panel rail */}
        <aside
          className={cn(
            "w-full flex-col p-3 lg:w-[372px] lg:shrink-0 lg:pr-0",
            mobileView === "preview" ? "hidden" : "flex",
            railCollapsed ? "lg:hidden" : "lg:flex",
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-2xl">
            {/* Section tabs — desktop (mobile switches via bottom nav) */}
            <div className="hidden items-center gap-1 border-b border-white/[0.08] p-2 lg:flex">
              {SECTIONS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchSection(key)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-medium transition-all",
                    section === key
                      ? "bg-white/90 text-black shadow-sm"
                      : "text-v-mut hover:bg-white/[0.07] hover:text-v-ink",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setRailCollapsed(true)}
                aria-label="Collapse panel for full-page preview"
                title="Full-page preview"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-v-faint transition-colors hover:bg-white/[0.07] hover:text-v-ink"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-2">
              {panelContent}
            </div>
          </div>
        </aside>

        {/* Preview stage */}
        <section
          className={cn(
            "relative min-h-0 flex-1 overflow-y-auto",
            mobileView === "panels" && "hidden lg:block",
          )}
        >
          {railCollapsed && (
            <button
              type="button"
              onClick={() => setRailCollapsed(false)}
              aria-label="Show panels"
              title="Show panels"
              className="fixed left-3 top-24 z-30 hidden h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/45 text-v-mut shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-colors hover:text-v-ink lg:flex"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <div className="flex min-h-full items-start justify-center px-4 pb-28 pt-6 lg:pb-8">
            {section === "chat" ? (
              <ChatPhonePreview chat={chat} venueName={data.org.name} />
            ) : previewMode === "live" ? (
              <LiveFrame
                slug={data.org.slug}
                locale={locale}
                viewport={viewport}
                reloadKey={liveReloadKey}
                onRetry={() => setLiveReloadKey((k) => k + 1)}
              />
            ) : (
              <MenuPreview
                config={design}
                org={previewOrg}
                menu={data.menu}
                locale={locale}
                replayKey={replayKey}
                viewport={viewport}
              />
            )}
          </div>
        </section>
      </div>

      {/* ── First-visit guided tour (tracked as onboarding) ── */}
      {tourOpen && (
        <StudioTutorial
          orgId={orgId}
          onApply={(a: TutorialApply) => {
            if (a.section) switchSection(a.section);
            if (a.mobileView) setMobileView(a.mobileView);
            if (a.previewMode) setPreviewMode(a.previewMode);
          }}
          onClose={() => {
            setTourDismissed(true);
            setTourManual(false);
          }}
        />
      )}

      {/* ── Mobile bottom button navigation ── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 px-4 lg:hidden"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 14px)" }}
      >
        <div className="mx-auto flex max-w-md items-center justify-around gap-1 rounded-[26px] border border-white/10 bg-black/55 px-2 py-2 shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          {SECTIONS.map(({ key, label, icon: Icon }) => {
            const active = mobileView === "panels" && section === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  switchSection(key);
                  setMobileView("panels");
                }}
                className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
                    active ? "bg-v-accent text-v-accent-ink" : "text-v-mut",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span
                  className={cn(
                    "text-[9px] font-medium uppercase tracking-[0.06em]",
                    active ? "text-v-accent" : "text-v-faint",
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileView("preview")}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1"
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
                mobileView === "preview"
                  ? "bg-v-accent text-v-accent-ink"
                  : "text-v-mut",
              )}
            >
              <Eye className="h-4 w-4" />
            </span>
            <span
              className={cn(
                "text-[9px] font-medium uppercase tracking-[0.06em]",
                mobileView === "preview" ? "text-v-accent" : "text-v-faint",
              )}
            >
              Preview
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
