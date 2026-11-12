import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { studioRouting } from "@/lib/studioRouting";

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

/**
 * Our own sign-in page (not Clerk's hosted one) on the request's host, then
 * back to where it was. On the Studio the way back is a path: the request
 * URL's host is not always the Studio's (local servers report localhost), and
 * a path always stays on the host the browser is on.
 */
function signIn(req: NextRequest, studio = false) {
  const url = new URL("/sign-in", req.url);
  // One leading slash: "//host" would read as another site.
  const back = `${req.nextUrl.pathname.replace(/^\/+/, "/")}${req.nextUrl.search}`;
  url.searchParams.set("redirect_url", studio ? back : req.nextUrl.href);
  return NextResponse.redirect(url);
}

export default clerkMiddleware(async (auth, req) => {
  // The host first: the Studio and the admin are one Next app (lib/studioRouting).
  const route = studioRouting(req.headers.get("host"), req.nextUrl);
  if (route.type === "redirect") return NextResponse.redirect(route.url);
  if (route.type === "rewrite") {
    // Studio pages need a session like every admin page; the pages themselves check the admin role.
    const { userId } = await auth();
    if (!userId) return signIn(req, true);
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
