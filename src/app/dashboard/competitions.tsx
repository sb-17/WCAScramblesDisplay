"use client";

import { useEffect, useState } from "react";
import { toBase64 } from "@/lib/bytes";
import { exportDataKey, generateDataKey, wrapToPublicKey } from "@/lib/crypto";

interface Competition {
  id: string;
  wcaCompetitionId: string;
  name: string;
  endsOn: string | null;
  canPush: boolean;
  setCount: number;
}

interface SearchResult {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export default function Competitions({ keys }: { keys: CryptoKeyPair }) {
  const [competitions, setCompetitions] = useState<Competition[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/competitions");
    const body = (await response.json()) as { competitions: Competition[] };
    setCompetitions(body.competitions);
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Debounced so typing a competition name does not hammer the WCA API.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/competitions/search?q=${encodeURIComponent(trimmed)}`);
        const body = (await response.json()) as { competitions?: SearchResult[] };
        if (!cancelled) setResults(body.competitions ?? []);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function add(competition: SearchResult) {
    setCreating(competition.id);
    setError(null);
    try {
      // The competition key is created here and wrapped to this Delegate before it is sent.
      // The server receives only the wrapper.
      const competitionKey = await generateDataKey();
      const wrapped = await wrapToPublicKey(await exportDataKey(competitionKey), keys.publicKey);

      const response = await fetch("/api/competitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wcaCompetitionId: competition.id,
          wrappedCompetitionKey: toBase64(wrapped),
        }),
      });

      if (response.status === 409) {
        const body = (await response.json()) as { ownerName?: string };
        setError(
          `${body.ownerName ?? "Another Delegate"} has already set up ${competition.name}. ` +
            "Ask them to give you access rather than setting it up again.",
        );
        return;
      }
      if (!response.ok) {
        setError("Could not add that competition.");
        return;
      }

      setQuery("");
      setResults([]);
      await refresh();
    } catch {
      setError("Could not add that competition.");
    } finally {
      setCreating(null);
    }
  }

  const alreadyAdded = new Set(competitions?.map((c) => c.wcaCompetitionId) ?? []);

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Your competitions</h2>

        {competitions === null ? <p className="muted">Loading…</p> : null}

        {competitions?.length === 0 ? (
          <p className="muted">
            No competitions yet. Search below for one you are delegating.
          </p>
        ) : null}

        {competitions?.map((competition) => (
          <div key={competition.id} className="listitem">
            <div>
              <div>{competition.name}</div>
              <div className="muted" style={{ fontSize: "0.875rem" }}>
                {competition.setCount === 0
                  ? "No scrambles uploaded yet"
                  : `${competition.setCount} scramble set${competition.setCount === 1 ? "" : "s"}`}
                {competition.canPush ? "" : " · view only"}
              </div>
            </div>
            <span className="tag mono">{competition.wcaCompetitionId}</span>
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2>Add a competition</h2>
        <p className="muted">
          Only competitions where the WCA lists you as a Delegate will appear.
        </p>
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Competition name"
          autoComplete="off"
        />

        {searching ? <p className="muted">Searching…</p> : null}

        {!searching && query.trim().length >= 3 && results.length === 0 ? (
          <p className="muted">No competitions found that you are delegating.</p>
        ) : null}

        {results.map((result) => (
          <div key={result.id} className="listitem">
            <div>
              <div>{result.name}</div>
              <div className="muted" style={{ fontSize: "0.875rem" }}>
                {result.startDate === result.endDate
                  ? result.startDate
                  : `${result.startDate} – ${result.endDate}`}
              </div>
            </div>
            {alreadyAdded.has(result.id) ? (
              <span className="tag">Added</span>
            ) : (
              <button
                className="button"
                onClick={() => void add(result)}
                disabled={creating !== null}
              >
                {creating === result.id ? "Adding…" : "Add"}
              </button>
            )}
          </div>
        ))}

        {error ? (
          <div className="notice">
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
