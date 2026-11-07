import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Georgian } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import "../globals.css";
import { ClerkProvider } from "@/components/clerk-provider";
import ConvexClientProvider from "@/components/ConvexProviderWithClerk";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const georgian = Noto_Sans_Georgian({
  variable: "--font-ka",
  subsets: ["georgian"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: "Shemoqmedi Admin",
  description: "Admin dashboard for shemoqmedi.space",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <ClerkProvider>
      <html lang={locale} className="dark">
        <body
          className={`${sans.variable} ${mono.variable} ${georgian.variable} font-sans antialiased`}
        >
          <NextIntlClientProvider messages={messages}>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
