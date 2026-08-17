import { NextResponse } from "next/server";
import { grantAccess, isOwnerOf, listAccess, searchDelegates } from "@/db/access";
import { accessTo } from "@/db/competitions";
import { fromBase64, toBase64 } from "@/lib/bytes";
import { readSession } from "@/lib/session";

/**
 * Anyone with access can see who else has it -- who can reach a competition's scrambles is
 * not something to hide from the people who can already reach them. A `q` parameter
 * searches instead, for the owner adding somebody.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  if (!(await accessTo(id, session.wcaUserId))) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query) {
    if (!(await isOwnerOf(id, session.wcaUserId))) {
      return NextResponse.json({ error: "not-owner" }, { status: 403 });
    }
    if (query.length < 2) return NextResponse.json({ candidates: [] });

    const candidates = await searchDelegates(query, id);
    return NextResponse.json({
      candidates: candidates.map((candidate) => ({
        wcaUserId: candidate.wcaUserId,
        name: candidate.name,
        wcaId: candidate.wcaId,
        publicKey: toBase64(candidate.publicKey),
      })),
    });
  }

  return NextResponse.json({
    delegates: await listAccess(id),
    isOwner: await isOwnerOf(id, session.wcaUserId),
  });
}

/** Owner only: granting access hands over the scrambles for the whole competition. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  if (!(await isOwnerOf(id, session.wcaUserId))) {
    return NextResponse.json({ error: "not-owner" }, { status: 403 });
  }

  let body: { wcaUserId?: number; wrappedCompetitionKey?: string; canPush?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!Number.isInteger(body.wcaUserId) || !body.wrappedCompetitionKey) {
    return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  }

  await grantAccess({
    competitionId: id,
    wcaUserId: body.wcaUserId as number,
    wrappedCompetitionKey: fromBase64(body.wrappedCompetitionKey),
    canPush: body.canPush !== false,
    grantedBy: session.wcaUserId,
  });

  return NextResponse.json({ ok: true });
}
