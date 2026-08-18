import { NextResponse } from "next/server";
import { accessTo } from "@/db/competitions";
import { cachedSetsFor, pushToDevice } from "@/db/devices";
import { fromBase64 } from "@/lib/bytes";
import { readSession } from "@/lib/session";

/**
 * The Delegate's browser has already unwrapped the set key and re-wrapped it to this
 * device's public key; the server only relays the wrapper. Passing setId null clears the
 * screen, which also drops the device's key for whatever it was showing.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; deviceId: string }> },
) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, deviceId } = await context.params;
  const access = await accessTo(id, session.wcaUserId);
  if (!access) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!access.canPush) return NextResponse.json({ error: "view-only" }, { status: 403 });

  let body: { setId?: string | null; wrappedSetKey?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const setId = body.setId ?? null;
  if (setId !== null && !body.wrappedSetKey) {
    return NextResponse.json({ error: "missing-key" }, { status: 400 });
  }

  // Refuse a set the display has not downloaded. Without this the scramblers get an error
  // where the scrambles should be, which at a competition reads as the app being broken.
  // A device that has never reported its cache is left alone rather than blocked.
  if (setId !== null) {
    const cached = await cachedSetsFor(deviceId);
    if (cached !== null && !cached.includes(setId)) {
      return NextResponse.json({ error: "not-downloaded" }, { status: 409 });
    }
  }

  const pushed = await pushToDevice({
    competitionId: id,
    deviceId,
    setId,
    wrappedSetKey: body.wrappedSetKey ? fromBase64(body.wrappedSetKey) : null,
    pushedBy: session.wcaUserId,
  });

  // Covers an unpaired device and an expired session alike -- neither can be pushed to.
  if (!pushed) return NextResponse.json({ error: "not-available" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
