'use client'

import { ReactNode } from 'react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { useAuth } from '@clerk/nextjs'

if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    throw new Error('Missing NEXT_PUBLIC_CONVEX_URL in your .env file')
}

const dev = process.env.NODE_ENV === 'development'

// By default the Convex client console.error()s every failed call with its
// request id and server stack, which Next's dev overlay pops up and anyone
// can read in the browser console. Failed calls are caught by the forms and
// shown as alerts (components/admin/Alerts.tsx), so errors are never logged
// here. Server function logs still reach the console in development only;
// production logs stay in the Convex dashboard.
const logger = {
    logVerbose() {},
    log: (...args: unknown[]) => { if (dev) console.log(...args) },
    warn: (...args: unknown[]) => { if (dev) console.warn(...args) },
    error() {},
}

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL, { logger })

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
    return (
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            {children}
        </ConvexProviderWithClerk>
    )
}
