import { NextResponse } from "next/server";
import { claimIdentity, getIdentity } from "@/db/users";
import { fromBase64, toBase64 } from "@/lib/bytes";
import { readSession } from "@/lib/session";

/**
 * Returns the recovery material for the signed-in Delegate. Handing it over is safe: it is
 * encrypted under a phrase the server has never seen, so it is inert without it.
 */
export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const identity = await getIdentity(session.wcaUserId);
  if (!identity) return NextResponse.json({ hasIdentity: false });

  return NextResponse.json({
    hasIdentity: true,
    publicKey: toBase64(identity.publicKey),
    recoverySalt: toBase64(identity.recoverySalt),
    recoveryBlob: toBase64(identity.recoveryBlob),
  });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { publicKey?: string; recoverySalt?: string; recoveryBlob?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!body.publicKey || !body.recoverySalt || !body.recoveryBlob) {
    return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  }

  const publicKey = fromBase64(body.publicKey);
  // Raw P-256 is 0x04 ‖ x ‖ y. Reject anything else rather than store an unusable key.
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    return NextResponse.json({ error: "invalid-public-key" }, { status: 400 });
  }

  const claimed = await claimIdentity(session.wcaUserId, {
    publicKey,
    recoverySalt: fromBase64(body.recoverySalt),
    recoveryBlob: fromBase64(body.recoveryBlob),
  });

  if (!claimed) {
    return NextResponse.json({ error: "already-registered" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
