import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Everything except these (dashboard, /api/*) requires a Clerk session. The
// MCP connector checks its own OAuth tokens (lib/mcp), and MCP clients probing
// for OAuth metadata get a clean answer instead of a sign-in redirect.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/mcp(.*)",
  "/.well-known(.*)",
]);

const isApiRoute = createRouteMatcher(["/api/(.*)", "/trpc/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  // API routes answer 401/404 instead of redirecting.
  if (isApiRoute(req)) {
    await auth.protect();
    return;
  }

  const { userId } = await auth();
  if (!userId) {
    // Our own sign-in page (not Clerk's hosted one), then back here.
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("redirect_url", req.nextUrl.href);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
