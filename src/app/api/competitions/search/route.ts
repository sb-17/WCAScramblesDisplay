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

  /**
   * Hide competitions that are over. The one day of slack is deliberate: hiding a
   * competition a Delegate needs right now is a far worse failure than showing one that
   * finished yesterday, and competition dates are local while this clock is UTC.
   */
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const competitions = await searchCompetitions(query);
    return NextResponse.json({
      competitions: competitions
        .filter((competition) => delegatesInclude(competition, session.wcaUserId))
        .filter((competition) => competition.end_date >= cutoff)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
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
