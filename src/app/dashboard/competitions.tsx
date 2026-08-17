"use client";

import { useEffect, useState } from "react";
import { toBase64 } from "@/lib/bytes";
import { exportDataKey, generateDataKey, wrapToPublicKey } from "@/lib/crypto";

interface Competition {
  id: string;
  /** Null for unofficial competitions. */
  wcaCompetitionId: string | null;
  name: string;
  endsOn: string | null;
  canPush: boolean;
  setCount: number;
  isOwner: boolean;
}

interface SearchResult {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function Competitions({ keys }: { keys: CryptoKeyPair }) {
  const [competitions, setCompetitions] = useState<Competition[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unofficialName, setUnofficialName] = useState("");
  const [unofficialDate, setUnofficialDate] = useState(today());
  const [confirming, setConfirming] = useState<string | null>(null);

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

  /**
   * The competition key is created here and wrapped to this Delegate before it is sent, so
   * the server only ever receives the wrapper.
   */
  async function create(body: Record<string, unknown>): Promise<Response> {
    const competitionKey = await generateDataKey();
    const wrapped = await wrapToPublicKey(await exportDataKey(competitionKey), keys.publicKey);
    return fetch("/api/competitions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, wrappedCompetitionKey: toBase64(wrapped) }),
    });
  }

  async function add(competition: SearchResult) {
    setCreating(competition.id);
    setError(null);
    try {
      const response = await create({ kind: "wca", wcaCompetitionId: competition.id });

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

  async function addUnofficial() {
    setCreating("unofficial");
    setError(null);
    try {
      const response = await create({
        kind: "unofficial",
        name: unofficialName.trim(),
        endsOn: unofficialDate,
      });
      if (!response.ok) {
        setError("Could not add that competition.");
        return;
      }
      setUnofficialName("");
      await refresh();
    } catch {
      setError("Could not add that competition.");
    } finally {
      setCreating(null);
    }
  }

  async function remove(competition: Competition) {
    setCreating(competition.id);
    setError(null);
    try {
      const response = await fetch(`/api/competitions/${competition.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError("Could not remove that competition.");
        return;
      }
      setConfirming(null);
      await refresh();
    } catch {
      setError("Could not remove that competition.");
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
              <a href={`/competitions/${competition.id}`}>{competition.name}</a>
              <div className="muted" style={{ fontSize: "0.875rem" }}>
                {competition.setCount === 0
                  ? "No scrambles uploaded yet"
                  : `${competition.setCount} scramble set${competition.setCount === 1 ? "" : "s"}`}
                {competition.canPush ? "" : " · view only"}
              </div>
            </div>
            <div className="row">
              {competition.wcaCompetitionId ? (
                <span className="tag mono">{competition.wcaCompetitionId}</span>
              ) : (
                <span className="tag">Unofficial</span>
              )}

              {/* Two steps, because this deletes the uploaded scrambles with it. */}
              {competition.isOwner && confirming === competition.id ? (
                <>
                  <button
                    className="button button--danger"
                    onClick={() => void remove(competition)}
                    disabled={creating !== null}
                  >
                    {creating === competition.id ? "Removing…" : "Delete scrambles"}
                  </button>
                  <button className="button" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </>
              ) : null}

              {competition.isOwner && confirming !== competition.id ? (
                <button className="button" onClick={() => setConfirming(competition.id)}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2>Add a WCA competition</h2>
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Type at least 3 letters. Only competitions where you are listed as a Delegate
          appear.
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

      <div className="card stack">
        <h2>Add an unofficial competition</h2>
        <input
          className="input"
          value={unofficialName}
          onChange={(event) => setUnofficialName(event.target.value)}
          placeholder="Name"
          maxLength={120}
          autoComplete="off"
        />
        <label className="stack" style={{ gap: "0.375rem" }}>
          <span className="muted" style={{ fontSize: "0.875rem" }}>
            Last day of the competition
          </span>
          <input
            className="input"
            type="date"
            value={unofficialDate}
            onChange={(event) => setUnofficialDate(event.target.value)}
          />
        </label>
        <div>
          <button
            className="button"
            onClick={() => void addUnofficial()}
            disabled={creating !== null || unofficialName.trim().length === 0 || !unofficialDate}
          >
            {creating === "unofficial" ? "Adding…" : "Add unofficial competition"}
          </button>
        </div>
      </div>
    </div>
  );
}
