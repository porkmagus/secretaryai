import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getAuthCookieName,
  isSingleUserAuthEnabled,
  normalizeNextPath,
  verifySessionToken,
} from "./lib/auth";

function isAllowedPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/logout") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  );
}

export async function proxy(request: NextRequest) {
  if (!isSingleUserAuthEnabled() || isAllowedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(getAuthCookieName())?.value;
  const authenticated = await verifySessionToken(token);

  if (authenticated) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    normalizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
