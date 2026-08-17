import { NextResponse } from "next/server";
import {
  CompetitionTakenError,
  createCompetition,
  listCompetitionsFor,
} from "@/db/competitions";
import { fromBase64 } from "@/lib/bytes";
import { readSession } from "@/lib/session";
import { delegatesInclude, fetchCompetition } from "@/lib/wca";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  return NextResponse.json({ competitions: await listCompetitionsFor(session.wcaUserId) });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { wcaCompetitionId?: string; wrappedCompetitionKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!body.wcaCompetitionId || !body.wrappedCompetitionKey) {
    return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  }

  // Re-checked here rather than trusting the client's earlier search results.
  const competition = await fetchCompetition(body.wcaCompetitionId);
  if (!competition) {
    return NextResponse.json({ error: "unknown-competition" }, { status: 404 });
  }
  if (!delegatesInclude(competition, session.wcaUserId)) {
    return NextResponse.json({ error: "not-a-delegate-of-it" }, { status: 403 });
  }

  try {
    const id = await createCompetition({
      wcaCompetitionId: competition.id,
      name: competition.name,
      endsOn: competition.end_date ?? null,
      createdBy: session.wcaUserId,
      wrappedCompetitionKey: fromBase64(body.wrappedCompetitionKey),
    });
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof CompetitionTakenError) {
      return NextResponse.json(
        { error: "already-set-up", ownerName: err.ownerName },
        { status: 409 },
      );
    }
    console.error("Could not create competition", err);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
