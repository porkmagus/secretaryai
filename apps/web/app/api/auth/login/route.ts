import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  getAuthCookieName,
  getAuthPassword,
  getSessionLifetimeSeconds,
  isSingleUserAuthEnabled,
  normalizeNextPath,
} from "../../../../lib/auth";

type LoginRequest = {
  next?: string;
  password?: string;
};

function passwordsMatch(input: string, expected: string) {
  const inputHash = createHash("sha256").update(input).digest();
  const expectedHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(inputHash, expectedHash);
}

export async function POST(request: Request) {
  if (!isSingleUserAuthEnabled()) {
    return NextResponse.json(
      { error: "Single-user auth is not enabled for this install." },
      { status: 400 },
    );
  }

  let body: LoginRequest;

  try {
    body = (await request.json()) as LoginRequest;
  } catch {
    return NextResponse.json(
      { error: "Sign-in request body must be valid JSON." },
      { status: 400 },
    );
  }

  const password = body.password?.trim() ?? "";
  const expected = getAuthPassword();

  if (!passwordsMatch(password, expected)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = await createSessionToken();
  const redirectTo = normalizeNextPath(body.next);
  const response = NextResponse.json({ ok: true, redirectTo });

  response.cookies.set({
    name: getAuthCookieName(),
    value: token,
    httpOnly: true,
    maxAge: getSessionLifetimeSeconds(),
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
