import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

const intlMiddleware = createMiddleware({
  locales: ["en", "ka", "ru"],
  defaultLocale: "en",
});

// Everything else (dashboard, /api/*) requires a Clerk session.
// Sign-in/up must stay public with or without the locale prefix.
const isPublicRoute = createRouteMatcher([
  "/",
  "/:locale",
  "/:locale/sign-in(.*)",
  "/:locale/sign-up(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const isApiRoute = createRouteMatcher(["/api/(.*)", "/trpc/(.*)"]);

// Send signed-out visitors to our own localized sign-in page (not Clerk's
// hosted Account Portal), then back to where they were going.
function redirectToSignIn(req: NextRequest) {
  const locale = req.nextUrl.pathname.split("/")[1] || "en";
  const url = new URL(`/${locale}/sign-in`, req.url);
  url.searchParams.set("redirect_url", req.nextUrl.href);
  return NextResponse.redirect(url);
}

export default clerkMiddleware(async (auth, req) => {
  // API routes: require a session, never add a locale prefix.
  if (isApiRoute(req)) {
    await auth.protect();
    return;
  }

  if (!isPublicRoute(req)) {
    const { userId } = await auth();
    if (!userId) return redirectToSignIn(req);
  }

  return intlMiddleware(req);
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
