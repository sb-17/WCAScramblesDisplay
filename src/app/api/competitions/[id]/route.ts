import { NextResponse } from "next/server";
import { accessTo, deleteCompetition } from "@/db/competitions";
import { listScrambleSets } from "@/db/scramble-sets";
import { toBase64 } from "@/lib/bytes";
import { readSession } from "@/lib/session";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  const access = await accessTo(id, session.wcaUserId);
  if (!access) return NextResponse.json({ error: "not-found" }, { status: 404 });

  return NextResponse.json({
    name: access.name,
    wcaCompetitionId: access.wcaCompetitionId,
    endsOn: access.endsOn,
    canPush: access.canPush,
    wrappedCompetitionKey: toBase64(access.wrappedCompetitionKey),
    sets: await listScrambleSets(id),
  });
}

/**
 * Removes the competition and everything under it. Restricted to the creator: this
 * destroys the scrambles for everyone with access, not only for the caller.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  const removed = await deleteCompetition(id, session.wcaUserId);
  if (!removed) return NextResponse.json({ error: "not-owner" }, { status: 403 });

  return NextResponse.json({ ok: true });
}
