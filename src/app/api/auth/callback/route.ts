import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { STATE_COOKIE, callbackUrl, exchangeCode, fetchMe, isDelegate } from "@/lib/wca";

function fail(request: Request, reason: string) {
  return NextResponse.redirect(new URL(`/?error=${reason}`, request.url));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (params.get("error")) return fail(request, "denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail(request, "state");
  }

  let user;
  try {
    user = await fetchMe(await exchangeCode(code, callbackUrl(request)));
  } catch (err) {
    console.error("WCA sign-in failed", err);
    return fail(request, "wca");
  }

  if (!isDelegate(user)) return fail(request, "not-delegate");

  await createSession({
    wcaUserId: user.id,
    name: user.name,
    wcaId: user.wca_id,
    delegateStatus: user.delegate_status as string,
  });

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
