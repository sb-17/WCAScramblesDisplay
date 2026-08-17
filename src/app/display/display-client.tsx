"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fromBase64, toBase64 } from "@/lib/bytes";
import {
  decryptData,
  exportPublicKey,
  generateIdentity,
  importDataKey,
  unwrapWithPrivateKey,
} from "@/lib/crypto";
import {
  cacheSet,
  cachedSet,
  cachedSetIds,
  clearCache,
  forgetToken,
  loadDeviceKeys,
  readToken,
  saveDeviceKeys,
  writeToken,
} from "@/lib/display-store";
import { clearIdentities } from "@/lib/identity-store";
import { webCryptoAvailable } from "@/lib/webcrypto";
import { unpackSet } from "@/scrambles/payload";
import InsecureContext from "../insecure-context";
import PdfView from "./pdf-view";

const POLL_VISIBLE_MS = 3_000;
const POLL_HIDDEN_MS = 15_000;

interface SetMeta {
  id: string;
  label: string;
  bytes: number;
}

interface State {
  deviceName: string;
  setId: string | null;
  label: string | null;
  pushedAt: string | null;
  wrappedSetKey: string | null;
}

export default function DisplayClient() {
  const [secure, setSecure] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  const [state, setState] = useState<State | null>(null);
  const [caching, setCaching] = useState<{ done: number; total: number } | null>(null);
  const [showing, setShowing] = useState<{
    setId: string;
    label: string;
    pdf: Uint8Array;
    passcode: string;
  } | null>(null);
  // A pushed set is decrypted but kept covered until somebody at the table confirms it.
  const [confirmed, setConfirmed] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const keysRef = useRef<CryptoKeyPair | null>(null);
  const renderedRef = useRef<string | null>(null);

  useEffect(() => {
    setSecure(webCryptoAvailable());
    setToken(readToken());
  }, []);

  /** Keeps the screen awake; a tablet sleeping mid-round defeats the point. */
  useEffect(() => {
    if (!token) return;
    let lock: WakeLockSentinel | null = null;

    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        // Denied or unsupported. Nothing to do but carry on.
      }
    };

    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [token]);

  async function pair() {
    setPairing(true);
    setPairError(null);
    try {
      const keys = await generateIdentity();
      const response = await fetch("/api/devices/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          publicKey: toBase64(await exportPublicKey(keys.publicKey)),
        }),
      });

      if (!response.ok) {
        setPairError("That code was not accepted. It may be wrong, expired or already used.");
        return;
      }

      const claimed = (await response.json()) as { token: string };
      await saveDeviceKeys(keys);
      writeToken(claimed.token);
      keysRef.current = keys;

      // This browser is now a display, so it stops being a Delegate device. Forgetting to
      // sign out is the failure this prevents, and a tablet left in the scrambling area
      // holding a Delegate's private key would open every scramble set they can reach.
      await standDownAsDelegate();

      setToken(claimed.token);
      setCode("");
    } catch (err) {
      // Surfaced verbatim: a generic message here hid a missing crypto.subtle for far too long.
      setPairError(`Could not pair: ${(err as Error).message}`);
    } finally {
      setPairing(false);
    }
  }

  /**
   * There is no unpair control on this screen on purpose: a display in the scrambling area
   * should not be able to take itself out of service. It returns to the code screen only
   * when the Delegate removes it or the session ends, which the server reports as a 401.
   */
  const resetToPairing = useCallback(async () => {
    await clearCache();
    forgetToken();
    keysRef.current = null;
    renderedRef.current = null;
    setToken(null);
    setState(null);
    setShowing(null);
    setShowError(null);
  }, []);

  /** Downloads every set as ciphertext so a flaky network cannot stop a scramble appearing. */
  const fillCache = useCallback(async (bearer: string) => {
    const response = await fetch("/api/display/sets", {
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (!response.ok) return;

    const body = (await response.json()) as { sets: SetMeta[] };
    const have = new Set(await cachedSetIds());
    const missing = body.sets.filter((set) => !have.has(set.id));
    if (missing.length === 0) return;

    setCaching({ done: 0, total: missing.length });
    let done = 0;
    for (const set of missing) {
      const one = await fetch(`/api/display/sets/${set.id}`, {
        headers: { authorization: `Bearer ${bearer}` },
      });
      if (one.ok) {
        const payload = (await one.json()) as { ciphertext: string };
        await cacheSet(set.id, fromBase64(payload.ciphertext));
      }
      done += 1;
      setCaching({ done, total: missing.length });
    }
    setCaching(null);
  }, []);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      keysRef.current ??= await loadDeviceKeys();
      await fillCache(token);
    })();
  }, [token, fillCache]);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const response = await fetch("/api/display/state", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (response.status === 401) {
          // Removed by the Delegate, or the session expired. Wipe the cached scrambles and
          // go back to the code screen rather than sitting on a sheet we can no longer hold.
          await resetToPairing();
          return;
        }
        if (response.ok) {
          setOffline(false);
          setState((await response.json()) as State);
        }
      } catch {
        setOffline(true);
      } finally {
        if (!stopped) {
          const delay =
            document.visibilityState === "visible" ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
          timer = setTimeout(() => void poll(), delay);
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token, resetToPairing]);

  // Decrypts whatever has been pushed. The key arrives with the push and covers only this
  // set, so nothing else in the cache becomes readable.
  useEffect(() => {
    if (!state || !token) return;

    const marker = `${state.setId ?? "none"}:${state.pushedAt ?? ""}`;
    if (renderedRef.current === marker) return;
    renderedRef.current = marker;

    void (async () => {
      if (!state.setId || !state.wrappedSetKey) {
        setShowing(null);
        setConfirmed(false);
        setShowError(null);
        // Nothing to check when a screen is being blanked.
        await ack(token, null, true);
        return;
      }

      try {
        const keys = keysRef.current ?? (await loadDeviceKeys());
        if (!keys) throw new Error("This device has no key");

        const ciphertext = await cachedSet(state.setId);
        if (!ciphertext) throw new Error("Not downloaded yet");

        const setKey = await importDataKey(
          await unwrapWithPrivateKey(fromBase64(state.wrappedSetKey), keys.privateKey),
        );
        const { pdf, passcode } = unpackSet(await decryptData(setKey, ciphertext));

        setShowError(null);
        setConfirmed(false);
        setShowing({ setId: state.setId, label: state.label ?? "", pdf, passcode });
        // Reported as arrived but unconfirmed, so the Delegate can see it is waiting.
        await ack(token, state.setId, false);
      } catch (err) {
        setShowing(null);
        setConfirmed(false);
        setShowError(`Could not open that scramble set: ${(err as Error).message}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.setId, state?.pushedAt, token]);

  if (!secure) {
    return (
      <main className="display-pair">
        <div style={{ maxWidth: "24rem", width: "100%" }}>
          <InsecureContext />
        </div>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="display-pair">
        <div className="card stack" style={{ maxWidth: "24rem", width: "100%" }}>
          <h1>Pair this display</h1>
          <p className="muted">Enter the code from the Delegate&rsquo;s phone.</p>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            Pairing signs out any Delegate on this device and removes their key from it.
          </p>
          <input
            className="input mono"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="XXXXXXXX"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.trim().length > 0) void pair();
            }}
            style={{ fontSize: "1.5rem", textAlign: "center", letterSpacing: "0.15em" }}
          />
          <button
            type="button"
            className="button button--primary"
            onClick={() => void pair()}
            disabled={pairing || code.trim().length === 0}
          >
            {pairing ? "Pairing…" : "Pair"}
          </button>
          {pairError ? (
            <div className="notice">
              <p>{pairError}</p>
            </div>
          ) : null}

          {/*
            Only offered before pairing. Once a display is in service it deliberately has no
            way out of this screen, so a scrambler cannot navigate away from what was pushed.
          */}
          <a className="muted" href="/" style={{ fontSize: "0.875rem", textAlign: "center" }}>
            Delegate sign-in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="display">
      <header className="display-header">
        <div className="display-title">
          {(confirmed ? showing?.label : null) ?? state?.deviceName ?? "Display"}
        </div>
        <div className="row">
          {offline ? <span className="tag">Offline</span> : null}
          {caching ? (
            <span className="tag">
              Downloading {caching.done}/{caching.total}
            </span>
          ) : null}
        </div>
      </header>

      <section
        className={showing && confirmed ? "display-body display-body--sheet" : "display-body"}
      >
        {showError ? <p className="notice">{showError}</p> : null}
        {!showError && !showing ? <p className="muted">Waiting for a scramble set…</p> : null}

        {/*
          The scrambles stay covered until somebody at the table agrees this is the group
          they are about to scramble. Typing a passcode used to catch a wrong set by simply
          not opening it; this puts that check back, with the person who knows which group
          is up rather than the Delegate who chose it.
        */}
        {showing && !confirmed ? (
          <div className="confirm">
            <p className="muted">Is this the set you are about to scramble?</p>
            <p className="confirm-label">{showing.label}</p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setConfirmed(true);
                void ack(token, showing.setId, true);
              }}
            >
              Yes, show the scrambles
            </button>
            <p className="muted" style={{ fontSize: "0.875rem" }}>
              If this is not the right set, tell the Delegate. Nothing is shown until you
              press the button.
            </p>
          </div>
        ) : null}

        {showing && confirmed ? (
          <PdfView key={showing.setId} pdf={showing.pdf} passcode={showing.passcode} />
        ) : null}
      </section>
    </main>
  );
}

/**
 * Ends any Delegate session in this browser and removes their key from it. Failures are
 * swallowed on purpose: pairing must not be blocked by cleanup that is belt-and-braces.
 */
async function standDownAsDelegate(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", redirect: "manual" });
  } catch {
    // Already signed out, or offline. Either way there is nothing to end.
  }
  try {
    await clearIdentities();
  } catch {
    // No key stored here.
  }
}

async function ack(token: string, setId: string | null, confirmed: boolean): Promise<void> {
  try {
    await fetch("/api/display/state", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ setId, confirmed }),
    });
  } catch {
    // The next poll will try again.
  }
}
