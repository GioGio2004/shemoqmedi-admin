"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";

// ─── TYPES ───────────────────────────────────────────────────
type Phase = "hidden" | "entering" | "visible" | "exiting";

// ─────────────────────────────────────────────────────────────
//  FirstTapActivationPopup
//
//  Drop this anywhere inside your Magic dashboard layout — it
//  renders nothing until the owner's tag receives its first-ever
//  tap, at which point Convex's realtime subscription picks up
//  pendingActivationAlert === true and the popup springs in.
//
//  Usage:
//    import { FirstTapActivationPopup } from "./_components/FirstTapActivationPopup";
//    ...
//    <FirstTapActivationPopup />
// ─────────────────────────────────────────────────────────────
export function FirstTapActivationPopup() {
    const { user, isLoaded } = useUser();
    const locale = useLocale();
    const router = useRouter();

    // Live subscription — Convex pushes updates the instant the tag doc changes
    const activeTag = useQuery(
        api.volootags.getActiveTag,
        isLoaded && user ? { userId: user.id } : "skip",
    );

    const clearAlert = useMutation(api.volootags.clearActivationAlert);

    const [phase, setPhase] = useState<Phase>("hidden");
    const [isSwitching, setIsSwitching] = useState(false);
    const hasTriggered = useRef(false);

    // Watch for the signal
    useEffect(() => {
        if (!activeTag || hasTriggered.current) return;
        if (activeTag.pendingActivationAlert === true) {
            hasTriggered.current = true;
            setPhase("entering");
            // Allow the CSS spring to settle before declaring "visible"
            const t = setTimeout(() => setPhase("visible"), 20);
            return () => clearTimeout(t);
        }
    }, [activeTag]);

    const dismiss = async (navigateToMagic = false) => {
        setPhase("exiting");

        // Clear the flag server-side immediately — don't await so the
        // animation isn't blocked.
        if (activeTag?._id) {
            clearAlert({ tagId: activeTag._id as any }).catch(() => { });
        }

        await new Promise((r) => setTimeout(r, 420)); // let exit animation finish
        setPhase("hidden");
        hasTriggered.current = false; // allow future re-triggers if needed

        if (navigateToMagic) {
            router.push(`/${locale}/magic`);
        }
    };

    const handleOpenMagic = async () => {
        setIsSwitching(true);
        await dismiss(true);
    };

    if (phase === "hidden") return null;

    const isEntering = phase === "entering" || phase === "visible";

    return (
        // Backdrop
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: "0 0 env(safe-area-inset-bottom, 0px)",
                background: isEntering ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0)",
                backdropFilter: isEntering ? "blur(12px)" : "blur(0px)",
                WebkitBackdropFilter: isEntering ? "blur(12px)" : "blur(0px)",
                transition: "background 0.4s ease, backdrop-filter 0.4s ease",
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) dismiss();
            }}
        >
            {/* Ambient glow behind the sheet */}
            <div
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 420,
                    height: 420,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)",
                    filter: "blur(40px)",
                    pointerEvents: "none",
                    opacity: isEntering ? 1 : 0,
                    transition: "opacity 0.5s ease",
                }}
            />

            {/* Sheet */}
            <div
                style={{
                    width: "100%",
                    maxWidth: 400,
                    background: "#18181b",
                    borderRadius: "28px 28px 0 0",
                    padding: "12px 24px 40px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    position: "relative",
                    transform: isEntering ? "translateY(0)" : "translateY(100%)",
                    opacity: isEntering ? 1 : 0,
                    transition: "transform 0.55s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease",
                    willChange: "transform",
                    overflow: "hidden",
                }}
            >
                {/* Drag handle */}
                <div
                    style={{
                        width: 36,
                        height: 4,
                        borderRadius: 2,
                        background: "rgba(255,255,255,0.12)",
                        marginBottom: 32,
                        flexShrink: 0,
                    }}
                />

                {/* NFC icon with pulsing rings */}
                <div style={{ position: "relative", width: 80, height: 80, marginBottom: 28, flexShrink: 0 }}>
                    <PulseRing delay={0} />
                    <PulseRing delay={0.8} />
                    <PulseRing delay={1.6} />
                    {/* Core */}
                    <div
                        style={{
                            position: "absolute",
                            inset: 4,
                            borderRadius: 18,
                            background: "rgba(249,115,22,0.12)",
                            border: "1px solid rgba(249,115,22,0.28)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            zIndex: 1,
                        }}
                    >
                        <NfcIcon />
                    </div>
                </div>

                {/* Badge */}
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "rgba(249,115,22,0.9)",
                        background: "rgba(249,115,22,0.1)",
                        border: "1px solid rgba(249,115,22,0.18)",
                        borderRadius: 20,
                        padding: "4px 14px",
                        marginBottom: 14,
                    }}
                >
                    First tap detected ✦
                </span>

                {/* Headline */}
                <h2
                    style={{
                        fontSize: 22,
                        fontWeight: 600,
                        color: "#fff",
                        textAlign: "center",
                        lineHeight: 1.3,
                        marginBottom: 10,
                        letterSpacing: "-0.02em",
                    }}
                >
                    Your tag is{" "}
                    <span style={{ color: "rgb(249,115,22)" }}>live ✦</span>
                </h2>

                {/* Body */}
                <p
                    style={{
                        fontSize: 14,
                        color: "rgba(255,255,255,0.45)",
                        textAlign: "center",
                        lineHeight: 1.65,
                        marginBottom: 36,
                        maxWidth: 280,
                    }}
                >
                    Someone just tapped your Voloo Magic tag for the first time.
                    Set your mode and see every connection from your dashboard.
                </p>

                {/* Actions */}
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                    <button
                        onClick={handleOpenMagic}
                        disabled={isSwitching}
                        style={{
                            width: "100%",
                            padding: "16px 20px",
                            borderRadius: 16,
                            background: "rgb(249,115,22)",
                            border: "none",
                            color: "#fff",
                            fontSize: 15,
                            fontWeight: 600,
                            cursor: isSwitching ? "default" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            opacity: isSwitching ? 0.7 : 1,
                            transition: "opacity 0.15s, transform 0.15s",
                            letterSpacing: "0.01em",
                        }}
                        onMouseDown={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)";
                        }}
                        onMouseUp={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                        }}
                    >
                        <ZapIcon />
                        {isSwitching ? "Opening…" : "Open Voloo Magic"}
                        <ArrowIcon />
                    </button>

                    <button
                        onClick={() => dismiss()}
                        style={{
                            width: "100%",
                            padding: "14px 20px",
                            borderRadius: 16,
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            color: "rgba(255,255,255,0.35)",
                            fontSize: 14,
                            fontWeight: 400,
                            cursor: "pointer",
                            transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.09)";
                        }}
                        onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                        }}
                    >
                        Maybe later
                    </button>
                </div>

                {/* Bottom shimmer accent */}
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: "20%",
                        right: "20%",
                        height: 1,
                        background: "linear-gradient(to right, transparent, rgba(249,115,22,0.35), transparent)",
                        pointerEvents: "none",
                    }}
                />
            </div>

            {/* Keyframes injected once */}
            <style>{`
                @keyframes voloo-ring-expand {
                    0%   { transform: scale(1); opacity: 0.6; }
                    100% { transform: scale(2.4); opacity: 0; }
                }
            `}</style>
        </div>
    );
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────

function PulseRing({ delay }: { delay: number }) {
    return (
        <div
            style={{
                position: "absolute",
                inset: 4,
                borderRadius: 18,
                border: "1.5px solid rgba(249,115,22,0.45)",
                animation: `voloo-ring-expand 2.4s ease-out ${delay}s infinite`,
                pointerEvents: "none",
            }}
        />
    );
}

function NfcIcon() {
    return (
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
            stroke="rgb(249,115,22)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 01-8 0" />
        </svg>
    );
}

function ZapIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    );
}

function ArrowIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
        </svg>
    );
}