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
