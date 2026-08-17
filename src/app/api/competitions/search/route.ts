import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { delegatesInclude, searchCompetitions } from "@/lib/wca";

/**
 * Proxied rather than called from the browser so the results can be filtered to
 * competitions the signed-in Delegate actually delegates. Showing anything else would only
 * invite setting up a competition they cannot manage.
 */
export async function GET(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) return NextResponse.json({ competitions: [] });

  try {
    const competitions = await searchCompetitions(query);
    return NextResponse.json({
      competitions: competitions
        .filter((competition) => delegatesInclude(competition, session.wcaUserId))
        .map((competition) => ({
          id: competition.id,
          name: competition.name,
          startDate: competition.start_date,
          endDate: competition.end_date,
        })),
    });
  } catch (err) {
    console.error("Competition search failed", err);
    return NextResponse.json({ error: "wca-unavailable" }, { status: 502 });
  }
}
