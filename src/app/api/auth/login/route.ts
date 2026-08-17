import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { STATE_COOKIE, authorizeUrl, callbackUrl } from "@/lib/wca";

export async function GET(request: Request) {
  const state = crypto.randomUUID();

  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl(callbackUrl(request), state));
}
