"use client";

import { useEffect, useState } from "react";
import { exportDataKey, importPublicKey, wrapToPublicKey } from "@/lib/crypto";
import { fromBase64, toBase64 } from "@/lib/bytes";

interface Delegate {
  wcaUserId: number;
  name: string;
  wcaId: string | null;
  canPush: boolean;
  isOwner: boolean;
}

interface Candidate {
  wcaUserId: number;
  name: string;
  wcaId: string | null;
  publicKey: string;
}

export default function Delegates({
  competitionId,
  competitionKey,
}: {
  competitionId: string;
  competitionKey: CryptoKey | null;
}) {
  const [delegates, setDelegates] = useState<Delegate[] | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/competitions/${competitionId}/delegates`);
    if (!response.ok) return;
    const body = (await response.json()) as { delegates: Delegate[]; isOwner: boolean };
    setDelegates(body.delegates);
    setIsOwner(body.isOwner);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!isOwner || trimmed.length < 2) {
      setCandidates([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const response = await fetch(
        `/api/competitions/${competitionId}/delegates?q=${encodeURIComponent(trimmed)}`,
      );
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as { candidates?: Candidate[] };
      if (!cancelled) setCandidates(body.candidates ?? []);
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOwner, competitionId]);

  /**
   * The competition key is re-wrapped here, to the other Delegate's public key. The server
   * relays a wrapper it cannot open, so sharing never exposes the scrambles to it.
   */
  async function add(candidate: Candidate) {
    if (!competitionKey) {
      setError("This browser's key is not ready yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wrapped = await wrapToPublicKey(
        await exportDataKey(competitionKey),
        await importPublicKey(fromBase64(candidate.publicKey)),
      );

      const response = await fetch(`/api/competitions/${competitionId}/delegates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wcaUserId: candidate.wcaUserId,
          wrappedCompetitionKey: toBase64(wrapped),
        }),
      });
      if (!response.ok) {
        setError(`Could not give ${candidate.name} access.`);
        return;
      }
      setQuery("");
      setCandidates([]);
      await refresh();
    } catch {
      setError("Could not share the competition key.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(delegate: Delegate) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/competitions/${competitionId}/delegates/${delegate.wcaUserId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(`Could not remove ${delegate.name}.`);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <h2>Delegates</h2>

      {delegates === null ? <p className="muted">Loading…</p> : null}

      {delegates?.map((delegate) => (
        <div key={delegate.wcaUserId} className="listitem">
          <div style={{ minWidth: 0 }}>
            <div>{delegate.name}</div>
            <div className="muted" style={{ fontSize: "0.875rem" }}>
              {delegate.isOwner ? "Created this competition" : "Has access"}
              {delegate.canPush ? "" : " · view only"}
            </div>
          </div>
          {isOwner && !delegate.isOwner ? (
            <button
              type="button"
              className="button button--danger"
              onClick={() => void remove(delegate)}
              disabled={busy}
            >
              Remove
            </button>
          ) : (
            <span className="tag mono">{delegate.wcaId ?? "—"}</span>
          )}
        </div>
      ))}

      {isOwner ? (
        <div className="block">
          <div>Give another Delegate access</div>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            Type at least 2 letters. Only Delegates who have signed in here can be added.
          </p>
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or WCA ID"
            autoComplete="off"
          />
          {candidates.map((candidate) => (
            <div key={candidate.wcaUserId} className="listitem">
              <div>
                <div>{candidate.name}</div>
                <div className="muted mono" style={{ fontSize: "0.875rem" }}>
                  {candidate.wcaId ?? "—"}
                </div>
              </div>
              <button
                type="button"
                className="button"
                onClick={() => void add(candidate)}
                disabled={busy}
              >
                Add
              </button>
            </div>
          ))}
          {query.trim().length >= 2 && candidates.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.875rem" }}>
              Nobody found. They need to sign in here at least once first.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="notice">
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
