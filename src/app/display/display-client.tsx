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
import { unpackSet } from "@/scrambles/payload";

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
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  const [state, setState] = useState<State | null>(null);
  const [caching, setCaching] = useState<{ done: number; total: number } | null>(null);
  const [showing, setShowing] = useState<{ setId: string; label: string; pages: number } | null>(
    null,
  );
  const [showError, setShowError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const keysRef = useRef<CryptoKeyPair | null>(null);
  const renderedRef = useRef<string | null>(null);

  useEffect(() => {
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
      setToken(claimed.token);
      setCode("");
    } catch {
      setPairError("Could not reach the server.");
    } finally {
      setPairing(false);
    }
  }

  async function unpair() {
    await clearCache();
    forgetToken();
    keysRef.current = null;
    renderedRef.current = null;
    setToken(null);
    setState(null);
    setShowing(null);
  }

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
          setOffline(false);
          setState(null);
          setShowError("This device's session has ended. Pair it again.");
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
  }, [token]);

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
        setShowError(null);
        await ack(token, null);
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
        const { pdf } = unpackSet(await decryptData(setKey, ciphertext));

        setShowError(null);
        setShowing({ setId: state.setId, label: state.label ?? "", pages: pdf.byteLength });
        await ack(token, state.setId);
      } catch (err) {
        setShowing(null);
        setShowError(`Could not open that scramble set: ${(err as Error).message}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.setId, state?.pushedAt, token]);

  if (!token) {
    return (
      <main className="display-pair">
        <div className="card stack" style={{ maxWidth: "24rem", width: "100%" }}>
          <h1>Pair this display</h1>
          <p className="muted">Enter the code from the Delegate&rsquo;s phone.</p>
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
        </div>
      </main>
    );
  }

  return (
    <main className="display">
      <header className="display-header">
        <div className="display-title">{showing?.label ?? state?.deviceName ?? "Display"}</div>
        <div className="row">
          {offline ? <span className="tag">Offline</span> : null}
          {caching ? (
            <span className="tag">
              Downloading {caching.done}/{caching.total}
            </span>
          ) : null}
          <button type="button" className="button" onClick={() => void unpair()}>
            Unpair
          </button>
        </div>
      </header>

      <section className="display-body">
        {showError ? <p className="notice">{showError}</p> : null}
        {!showError && !showing ? <p className="muted">Waiting for a scramble set…</p> : null}
        {showing ? (
          <p className="muted">
            {showing.label} is decrypted and ready ({Math.round(showing.pages / 1024)} kB).
            Rendering comes next.
          </p>
        ) : null}
      </section>
    </main>
  );
}

async function ack(token: string, setId: string | null): Promise<void> {
  try {
    await fetch("/api/display/state", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ setId }),
    });
  } catch {
    // The next poll will try again.
  }
}
