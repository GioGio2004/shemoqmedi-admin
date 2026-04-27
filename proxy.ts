import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";

const routing = {
  locales: ["en", "ka", "tr"],
  defaultLocale: "en",
};

const intlMiddleware = createMiddleware(routing);

// THE FIX: Tell Clerk to ignore the sign-in/sign-up routes EVEN IF they have a locale prefix
const isPublicRoute = createRouteMatcher([
  "/:locale/sign-in(.*)",
  "/:locale/sign-up(.*)",
  "/:locale", // Landing page with locale
  "/sign-in(.*)", // Fallback without locale
  "/sign-up(.*)", // Fallback without locale
  "/", // Root
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  return intlMiddleware(req);
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
