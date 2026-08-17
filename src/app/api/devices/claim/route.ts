import { NextResponse } from "next/server";
import { claimDevice } from "@/db/devices";
import { fromBase64 } from "@/lib/bytes";

/**
 * Called by the display device itself, so there is no WCA session here -- the one-time
 * code is the only credential. It is single use and short lived, and claiming it clears it
 * in the same statement, so a code cannot be replayed or won twice.
 */
export async function POST(request: Request) {
  let body: { code?: string; publicKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!body.code || !body.publicKey) {
    return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  }

  const publicKey = fromBase64(body.publicKey);
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    return NextResponse.json({ error: "invalid-public-key" }, { status: 400 });
  }

  const claimed = await claimDevice(body.code, publicKey);
  // Deliberately one message for wrong, expired and already-used codes alike: telling a
  // stranger which of those it was only helps them guess.
  if (!claimed) return NextResponse.json({ error: "invalid-code" }, { status: 404 });

  return NextResponse.json(claimed);
}
