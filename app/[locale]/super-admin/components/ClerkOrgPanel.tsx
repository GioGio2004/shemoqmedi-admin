"use client";

import { OrganizationProfile } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

export function ClerkOrgPanel() {
  return (
    <div className="w-full flex justify-center">
      <OrganizationProfile
        routing="hash"
        appearance={{
          baseTheme: dark,
          variables: {
            colorPrimary: "white",
            colorBackground: "transparent",
            colorText: "white",
            colorTextSecondary: "#a1a1aa", // zinc-400 (highly legible gray)
            colorDanger: "hsl(var(--destructive))",
            colorInputBackground: "#09090b", // zinc-950 for input depth
            colorInputText: "white",
            borderRadius: "0.5rem", // Sharper, more minimalist borders
          },
          elements: {
            rootBox: "w-full max-w-full",
            cardBox: "w-full",
            // Use a solid black wrapper with a crisp border instead of blurry glass
            card: "bg-black border border-white/10 shadow-xl w-full rounded-xl",

            // Sidebar Navigation
            navbar: "border-r border-white/10 bg-[#09090b]",
            navbarButton: "text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors py-2 px-3",
            navbarButtonActive: "text-white bg-white/10 font-medium",
            navbarButtonIcon__active: "text-white",

            // Main Content
            pageScrollBox: "p-8",
            headerTitle: "text-white font-medium text-2xl tracking-tight",
            headerSubtitle: "text-zinc-400",

            profileSection: "border-b border-white/10 pb-8",
            profileSectionTitle: "text-white font-medium text-lg",
            profileSectionTitleText: "text-white",

            // Inputs
            formFieldInput: "bg-[#09090b] border border-white/20 text-white focus:ring-1 focus:ring-white focus:border-white rounded-lg transition-all",
            formFieldLabel: "text-zinc-300 text-sm font-medium",

            // Buttons - High contrast
            formButtonPrimary: "bg-white text-black hover:bg-zinc-200 font-medium rounded-lg shadow-none transition-all",
            formButtonReset: "text-zinc-400 hover:bg-white/5 hover:text-white rounded-lg",
            dangerButton: "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 rounded-lg shadow-none",

            // Tables
            tableHead: "text-zinc-400 text-xs uppercase font-medium tracking-wider bg-white/5",
            tableRow: "border-b border-white/10 hover:bg-white/5 transition-colors",
            tableCell: "text-white text-sm",

            // Badges
            badge: "bg-white/10 text-white border border-white/20 font-medium px-2.5 py-0.5 rounded-md",

            // Modals
            modalContent: "bg-[#09090b] border border-white/10 shadow-2xl rounded-xl",
            modalBackdrop: "bg-black/90 backdrop-blur-sm",

            avatarBox: "rounded-lg border border-white/10",
            avatarImage: "rounded-lg",

            membersPageInviteButton: "bg-white text-black hover:bg-zinc-200 shadow-none transition-all font-medium px-4 py-2 rounded-lg",
          },
        }}
      />
    </div>
  );
}