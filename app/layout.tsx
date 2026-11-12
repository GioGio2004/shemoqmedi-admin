import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@/components/clerk-provider";
import ConvexClientProvider from "@/components/ConvexProviderWithClerk";
import { AlertViewport } from "@/components/admin/Alerts";

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
  manifest: "/crow.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={inter.variable}>
          <ConvexClientProvider>{children}</ConvexClientProvider>
          <AlertViewport />
        </body>
      </html>
    </ClerkProvider>
  );
}
