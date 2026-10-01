import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfigError, isPublicPath, verifySessionToken } from "@/mvp/auth/session";
import { publicOrigin } from "@/mvp/auth/origin";

/**
 * Session gate (docs/mvp/12 §2). Every page and every /api/* route requires a valid session,
 * except /login and /api/mvp/login. Pages redirect to /login; APIs get 401 JSON.
 * If DEMO_PASSWORD or SESSION_SECRET is missing, everything fails closed (/login shows why).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  if (isPublicPath(pathname)) return NextResponse.next();

  const configError = authConfigError();
  const authenticated =
    !configError && (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET?.trim()));
  if (authenticated) return NextResponse.next();

  if (isApi) {
    return NextResponse.json(
      { error: configError ? "Authentication is not configured on the server." : "Not signed in." },
      { status: configError ? 503 : 401 },
    );
  }

  const loginUrl = new URL("/login", publicOrigin(request.url));
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next.js build assets, favicon.ico and robots.txt. Do NOT exclude by file
  // extension: dynamic segments such as /legacy/lead-lists/x.png would skip the session gate.
  // If public/ assets are added later, allow them by explicit path inside proxy().
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)"],
};
