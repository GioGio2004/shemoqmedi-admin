"use client";

import { OrganizationProfile } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

// RULED tokens (mirrors app/globals.css — Clerk cannot read CSS variables
// from appearance.variables, so the hex values are inlined here).
const V = {
  bg: "#0A0A0A",
  raise: "#111110",
  ink: "#F4F3F0",
  mut: "rgba(244, 243, 240, 0.62)",
  line: "rgba(244, 243, 240, 0.14)",
  accent: "#D8FF3A",
  accentInk: "#1A2000",
};

export function ClerkOrgPanel() {
  return (
    <div className="flex w-full justify-center">
      <OrganizationProfile
        routing="hash"
        appearance={{
          baseTheme: dark,
          variables: {
            colorPrimary: V.accent,
            colorBackground: "transparent",
            colorText: V.ink,
            colorTextSecondary: V.mut,
            colorDanger: "#f87171",
            colorInputBackground: V.bg,
            colorInputText: V.ink,
            borderRadius: "2px", // RULED radius
          },
          elements: {
            rootBox: "w-full max-w-full",
            cardBox: "w-full",
            // Flat raised surface + hairline — no glass, no blur
            card: "bg-[#111110] border border-[rgba(244,243,240,0.14)] shadow-none w-full rounded-[2px]",

            // Sidebar Navigation
            navbar: "border-r border-[rgba(244,243,240,0.14)] bg-[#0A0A0A]",
            navbarButton:
              "text-[rgba(244,243,240,0.62)] hover:text-[#F4F3F0] hover:bg-white/5 rounded-[2px] transition-colors py-2 px-3",
            navbarButtonActive: "text-[#F4F3F0] bg-white/10 font-medium",
            navbarButtonIcon__active: "text-[#F4F3F0]",

            // Main Content
            pageScrollBox: "p-4 sm:p-8",
            headerTitle: "text-[#F4F3F0] font-medium text-2xl tracking-tight",
            headerSubtitle: "text-[rgba(244,243,240,0.62)]",

            profileSection: "border-b border-[rgba(244,243,240,0.14)] pb-8",
            profileSectionTitle: "text-[#F4F3F0] font-medium text-lg",
            profileSectionTitleText: "text-[#F4F3F0]",

            // Inputs — flat stage-dark fields with hairline borders
            formFieldInput:
              "bg-[#0A0A0A] border border-[rgba(244,243,240,0.14)] text-[#F4F3F0] focus:ring-0 focus:border-[rgba(244,243,240,0.34)] rounded-[2px] transition-colors",
            formFieldLabel:
              "text-[rgba(244,243,240,0.62)] text-xs font-mono uppercase tracking-wider",

            // Buttons — accent primary, quiet everything else
            formButtonPrimary:
              "bg-[#D8FF3A] text-[#1A2000] hover:opacity-90 font-medium rounded-[2px] shadow-none transition-opacity",
            formButtonReset:
              "text-[rgba(244,243,240,0.62)] hover:bg-white/5 hover:text-[#F4F3F0] rounded-[2px]",
            dangerButton:
              "bg-transparent text-red-400 hover:bg-red-500/10 border border-red-500/40 rounded-[2px] shadow-none",

            // Tables
            tableHead:
              "text-[rgba(244,243,240,0.34)] text-[11px] uppercase font-mono tracking-wider bg-transparent",
            tableRow:
              "border-b border-[rgba(244,243,240,0.14)] hover:bg-white/5 transition-colors",
            tableCell: "text-[#F4F3F0] text-sm",

            // Badges — mono micro-label voice
            badge:
              "bg-transparent text-[rgba(244,243,240,0.62)] border border-[rgba(244,243,240,0.14)] font-mono uppercase text-[10px] tracking-wider px-2 py-0.5 rounded-[2px]",

            // Modals — flat, no blur
            modalContent:
              "bg-[#111110] border border-[rgba(244,243,240,0.14)] shadow-none rounded-[2px]",
            modalBackdrop: "bg-black/70",

            avatarBox: "rounded-[2px] border border-[rgba(244,243,240,0.14)]",
            avatarImage: "rounded-[2px]",

            membersPageInviteButton:
              "bg-[#D8FF3A] text-[#1A2000] hover:opacity-90 shadow-none transition-opacity font-medium px-4 py-2 rounded-[2px]",
          },
        }}
      />
    </div>
  );
}
