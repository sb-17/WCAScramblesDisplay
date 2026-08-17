import { NextResponse } from "next/server";
import { accessTo } from "@/db/competitions";
import { putScrambleSet } from "@/db/scramble-sets";
import { fromBase64 } from "@/lib/bytes";
import { readSession } from "@/lib/session";

/**
 * One set per request. A whole competition is 10-20 MB, which would exceed serverless
 * request body limits in a single call; per-set uploads also give honest progress and make
 * an interrupted upload resumable by re-running it.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  const access = await accessTo(id, session.wcaUserId);
  if (!access) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!access.canPush) return NextResponse.json({ error: "view-only" }, { status: 403 });

  let body: {
    label?: string;
    eventName?: string | null;
    roundNumber?: number | null;
    setLetter?: string | null;
    wrappedSetKey?: string;
    ciphertext?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!body.label || !body.wrappedSetKey || !body.ciphertext) {
    return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  }

  try {
    await putScrambleSet({
      competitionId: id,
      label: body.label,
      eventName: body.eventName ?? null,
      roundNumber: body.roundNumber ?? null,
      setLetter: body.setLetter ?? null,
      wrappedSetKey: fromBase64(body.wrappedSetKey),
      ciphertext: fromBase64(body.ciphertext),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Could not store scramble set", err);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
