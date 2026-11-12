import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { studioRouting, studioSignInUrl } from "@/lib/studioRouting";

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

// API routes that check access themselves (an admin session or a server key).
const isSelfCheckedApi = createRouteMatcher(["/api/graphics", "/api/graphics/(.*)"]);

/** Our own sign-in page (not Clerk's hosted one), then back to where it was. */
function signIn(req: NextRequest) {
  const url = new URL("/sign-in", req.url);
  url.searchParams.set("redirect_url", req.nextUrl.href);
  return NextResponse.redirect(url);
}

export default clerkMiddleware(async (auth, req) => {
  // The host first: the Studio and the admin are one Next app (lib/studioRouting).
  const route = studioRouting(req.headers.get("host"), req.nextUrl);
  if (route.type === "redirect") return NextResponse.redirect(route.url);
  if (route.type === "rewrite") {
    // Studio pages need a session like every admin page; the pages themselves check the admin role.
    // Sign-in on the Studio host itself (lib/studioRouting: never the request URL's origin, which is localhost locally).
    const { userId } = await auth();
    if (!userId) return NextResponse.redirect(studioSignInUrl(req.headers.get("host") ?? "", req.nextUrl));
    return NextResponse.rewrite(new URL(route.path, req.url));
  }

  if (isPublicRoute(req) || isSelfCheckedApi(req)) return;

  // API routes answer 401/404 instead of redirecting.
  if (isApiRoute(req)) {
    await auth.protect();
    return;
  }

  const { userId } = await auth();
  if (!userId) return signIn(req);
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
