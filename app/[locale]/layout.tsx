import type { Metadata } from 'next'
import { Outfit, JetBrains_Mono, Space_Grotesk, Noto_Sans_Georgian } from 'next/font/google'
import "../globals.css"
import { ClerkProvider } from '@clerk/nextjs'
import ConvexClientProvider from '@/components/ConvexProviderWithClerk'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'

const outfit = Outfit({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

// RULED display voice — same pairing as the consumer storefront so the two
// apps read as one product. Noto Sans Georgian covers ka glyphs.
const display = Space_Grotesk({
  variable: '--font-display',
  subsets: ['latin'],
  weight: 'variable',
  display: 'swap',
})

const georgian = Noto_Sans_Georgian({
  variable: '--font-ka',
  subsets: ['georgian'],
  weight: 'variable',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Shemoqmedi Admin',
  description: 'Admin dashboard for Shemoqmedi',
}

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
      <html lang={locale}>
        <body className={`${outfit.variable} ${jetbrainsMono.variable} ${display.variable} ${georgian.variable} font-sans antialiased`}>
          <NextIntlClientProvider messages={messages}>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}