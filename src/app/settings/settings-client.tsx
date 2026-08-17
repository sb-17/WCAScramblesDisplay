"use client";

import { useEffect, useState } from "react";
import { toBase64 } from "@/lib/bytes";
import {
  fingerprint,
  generateRecoveryPhrase,
  wrapPrivateKeyForRecovery,
} from "@/lib/crypto";
import { loadIdentity } from "@/lib/identity-store";

type Stage = "loading" | "missing" | "ready" | "phrase";

export default function SettingsClient({ wcaUserId }: { wcaUserId: number }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [keys, setKeys] = useState<CryptoKeyPair | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const local = await loadIdentity(wcaUserId);
      if (!local) {
        setStage("missing");
        return;
      }
      setKeys(local);
      setId(await fingerprint(local.publicKey));
      setStage("ready");
    })();
  }, [wcaUserId]);

  /** Same order as first-time setup: the phrase is shown and confirmed before it counts. */
  async function makePhrase() {
    if (!keys) return;
    setBusy(true);
    setError(null);
    try {
      setPhrase(generateRecoveryPhrase());
      setConfirmed(false);
      setStage("phrase");
    } finally {
      setBusy(false);
    }
  }

  async function savePhrase() {
    if (!keys || !phrase) return;
    setBusy(true);
    setError(null);
    try {
      const { salt, blob } = await wrapPrivateKeyForRecovery(keys.privateKey, phrase);
      const response = await fetch("/api/identity", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recoverySalt: toBase64(salt), recoveryBlob: toBase64(blob) }),
      });
      if (!response.ok) {
        setError("Could not save. Your old phrase still works.");
        return;
      }
      setPhrase(null);
      setStage("ready");
    } catch {
      setError("Could not save. Your old phrase still works.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "loading") return <p className="muted">Loading…</p>;

  if (stage === "missing") {
    return (
      <div className="card stack">
        <h2>Encryption key</h2>
        <p className="muted">Not set up in this browser.</p>
        <div>
          <a className="button" href="/dashboard">
            Set it up
          </a>
        </div>
      </div>
    );
  }

  if (stage === "phrase" && phrase) {
    return (
      <div className="card stack">
        <h2>New recovery phrase</h2>
        <p className="muted">Shown once. Replaces your previous phrase.</p>
        <p className="phrase mono">{phrase}</p>
        <label className="row">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I have written this down.</span>
        </label>
        <div className="row">
          <button
            className="button button--primary"
            onClick={() => void savePhrase()}
            disabled={!confirmed || busy}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="button" onClick={() => setStage("ready")} disabled={busy}>
            Cancel
          </button>
        </div>
        {error ? (
          <div className="notice">
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card stack">
      <h2>Encryption key</h2>

      {shown ? (
        <>
          <p className="phrase mono">{id}</p>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            Identifies your key. Not a secret, and it opens nothing.
          </p>
        </>
      ) : (
        <div>
          <button className="button" onClick={() => setShown(true)}>
            Show key
          </button>
        </div>
      )}

      <div className="listitem">
        <div>
          <div>Recovery phrase</div>
          <div className="muted" style={{ fontSize: "0.875rem" }}>
            Lost yours? Generate a new one.
          </div>
        </div>
        <button className="button" onClick={() => void makePhrase()} disabled={busy}>
          New phrase
        </button>
      </div>

      {error ? (
        <div className="notice">
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
