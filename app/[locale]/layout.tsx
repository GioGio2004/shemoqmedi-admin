import type { Metadata } from 'next'
import { Outfit, JetBrains_Mono } from 'next/font/google'
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
        <body className={`${outfit.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
          <NextIntlClientProvider messages={messages}>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}