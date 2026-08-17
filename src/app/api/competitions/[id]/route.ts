import { NextResponse } from "next/server";
import { accessTo } from "@/db/competitions";
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
