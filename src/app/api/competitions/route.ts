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

  let body: {
    kind?: "wca" | "unofficial";
    wcaCompetitionId?: string;
    name?: string;
    endsOn?: string;
    wrappedCompetitionKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!body.wrappedCompetitionKey) {
    return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  }

  let details: { wcaCompetitionId: string | null; name: string; endsOn: string | null };

  if (body.kind === "unofficial") {
    const name = body.name?.trim() ?? "";
    if (name.length === 0 || name.length > 120) {
      return NextResponse.json({ error: "invalid-name" }, { status: 400 });
    }
    if (!body.endsOn || !/^\d{4}-\d{2}-\d{2}$/.test(body.endsOn)) {
      return NextResponse.json({ error: "invalid-date" }, { status: 400 });
    }
    // Unofficial competitions have no WCA record, so there is nothing to verify against;
    // they belong to whoever created them.
    details = { wcaCompetitionId: null, name, endsOn: body.endsOn };
  } else {
    if (!body.wcaCompetitionId) {
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

    details = {
      wcaCompetitionId: competition.id,
      name: competition.name,
      endsOn: competition.end_date ?? null,
    };
  }

  try {
    const id = await createCompetition({
      ...details,
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
