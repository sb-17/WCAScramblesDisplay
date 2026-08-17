"use client";

import { useEffect, useRef, useState } from "react";
import { fromBase64, toBase64 } from "@/lib/bytes";
import {
  derivePublicKey,
  exportPublicKey,
  generateIdentity,
  generateRecoveryPhrase,
  recoverPrivateKey,
  wrapPrivateKeyForRecovery,
} from "@/lib/crypto";
import { loadIdentity, requestPersistence, saveIdentity } from "@/lib/identity-store";

type Stage = "checking" | "generate" | "phrase" | "recover" | "ready" | "mismatch";

interface ServerIdentity {
  hasIdentity: boolean;
  publicKey?: string;
  recoverySalt?: string;
  recoveryBlob?: string;
}

interface Pending {
  keys: CryptoKeyPair;
  phrase: string;
  salt: Uint8Array<ArrayBuffer>;
  blob: Uint8Array<ArrayBuffer>;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

export default function IdentitySetup({
  wcaUserId,
  onReady,
}: {
  wcaUserId: number;
  onReady: (keys: CryptoKeyPair) => void;
}) {
  // Held in a ref so a parent re-render cannot restart the identity check.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const [stage, setStage] = useState<Stage>("checking");
  const [server, setServer] = useState<ServerIdentity | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [phraseInput, setPhraseInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/identity");
      const remote = (await response.json()) as ServerIdentity;
      setServer(remote);

      const local = await loadIdentity(wcaUserId);
      if (!local) {
        setStage(remote.hasIdentity ? "recover" : "generate");
        return;
      }
      if (!remote.hasIdentity) {
        // Nothing is wrapped to the local key yet, so replacing it costs nothing.
        setStage("generate");
        return;
      }

      const mine = await exportPublicKey(local.publicKey);
      if (!sameBytes(mine, fromBase64(remote.publicKey ?? ""))) {
        setStage("mismatch");
        return;
      }
      setStage("ready");
      onReadyRef.current(local);
    })();
  }, [wcaUserId]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const keys = await generateIdentity();
      const phrase = generateRecoveryPhrase();
      const { salt, blob } = await wrapPrivateKeyForRecovery(keys.privateKey, phrase);
      setPending({ keys, phrase, salt, blob });
      setStage("phrase");
    } catch {
      setError("Could not generate a key in this browser.");
    } finally {
      setBusy(false);
    }
  }

  /** Only now is anything registered, so an abandoned setup leaves no orphaned key. */
  async function register() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicKey: toBase64(await exportPublicKey(pending.keys.publicKey)),
          recoverySalt: toBase64(pending.salt),
          recoveryBlob: toBase64(pending.blob),
        }),
      });

      if (response.status === 409) {
        setError("A key is already registered for this account. Restore it instead.");
        setStage("recover");
        return;
      }
      if (!response.ok) {
        setError("Could not register the key. Nothing was saved — try again.");
        return;
      }

      await saveIdentity(wcaUserId, pending.keys);
      await requestPersistence();
      setStage("ready");
      onReadyRef.current(pending.keys);
      setPending(null);
    } catch {
      setError("Could not register the key. Nothing was saved — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    if (!server?.recoveryBlob || !server.recoverySalt || !server.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const privateKey = await recoverPrivateKey(
        fromBase64(server.recoveryBlob),
        fromBase64(server.recoverySalt),
        phraseInput,
      );
      const publicKey = await derivePublicKey(privateKey);

      if (!sameBytes(await exportPublicKey(publicKey), fromBase64(server.publicKey))) {
        setError("That phrase produced a different key. Check it and try again.");
        return;
      }

      await saveIdentity(wcaUserId, { privateKey, publicKey });
      await requestPersistence();
      setPhraseInput("");
      setStage("ready");
      onReadyRef.current({ privateKey, publicKey });
    } catch {
      setError("That recovery phrase was not accepted.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "checking") return <p className="muted">Checking…</p>;

  // Nothing to say once the key works. Its status lives on the settings page.
  if (stage === "ready") return null;

  return (
    <div className="card stack">
      {stage === "generate" ? (
        <>
          <h2>Set up your encryption key</h2>
          <p className="muted">Generated in your browser and never sent anywhere.</p>
          <div>
            <button className="button button--primary" onClick={generate} disabled={busy}>
              {busy ? "Generating…" : "Generate key"}
            </button>
          </div>
        </>
      ) : null}

      {stage === "phrase" && pending ? (
        <>
          <h2>Write down your recovery phrase</h2>
          <p className="muted">Shown once. It is the only way back if this browser loses your key.</p>
          <p className="phrase mono">{pending.phrase}</p>
          <label className="row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I have written this down somewhere safe.</span>
          </label>
          <div>
            <button
              className="button button--primary"
              onClick={register}
              disabled={!confirmed || busy}
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          </div>
        </>
      ) : null}

      {stage === "recover" ? (
        <>
          <h2>Restore your encryption key</h2>
          <p className="muted">This browser does not have your key. Enter your recovery phrase.</p>
          <input
            className="input mono"
            value={phraseInput}
            onChange={(event) => setPhraseInput(event.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
          />
          <div>
            <button
              className="button button--primary"
              onClick={recover}
              disabled={busy || phraseInput.trim().length === 0}
            >
              {busy ? "Restoring…" : "Restore key"}
            </button>
          </div>
        </>
      ) : null}

      {stage === "mismatch" ? (
        <>
          <h2>This browser holds a different key</h2>
          <p className="muted">It cannot open your competitions. Restore the registered key.</p>
          <div>
            <button className="button" onClick={() => setStage("recover")}>
              Enter recovery phrase
            </button>
          </div>
        </>
      ) : null}

      {error ? (
        <div className="notice">
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
