import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@/components/clerk-provider";
import ConvexClientProvider from "@/components/ConvexProviderWithClerk";
import { AlertViewport } from "@/components/admin/Alerts";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Shemoqmedi Admin",
  description: "Admin for shemoqmedi.space",
  robots: { index: false, follow: false },
  // The crow, as on the site. New file names so cached copies of the old
  // icon (Claude shows the connector with this domain's icon) get replaced.
  icons: {
    icon: [
      { url: "/icons/crow-favicon.ico", sizes: "any" },
      { url: "/icons/crow-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/crow-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icons/crow-favicon.ico",
    apple: { url: "/icons/crow-180.png", sizes: "180x180" },
  },
  // The web app manifest comes from app/manifest.ts (per host: Studio or
  // Admin). On iPhone, installing from Safari's Share menu opens the app
  // full screen; the status bar stays white with dark text.
  appleWebApp: { capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  // Edge to edge on notched phones; globals.css pads with the safe-area insets.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      {/* The Studio sets data-studio-theme on <html> before hydration (app/studio/layout.tsx). */}
      <html lang="en" suppressHydrationWarning>
        <body className={inter.variable}>
          <ConvexClientProvider>{children}</ConvexClientProvider>
          <AlertViewport />
          <ServiceWorkerRegister />
        </body>
      </html>
    </ClerkProvider>
  );
}
