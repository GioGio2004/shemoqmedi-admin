import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import "../globals.css"
import { ClerkProvider } from '@clerk/nextjs'
import ConvexClientProvider from '@/components/ConvexProviderWithClerk'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
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
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <NextIntlClientProvider messages={messages}>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}