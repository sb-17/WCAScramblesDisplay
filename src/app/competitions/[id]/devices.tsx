"use client";

import { useEffect, useState } from "react";
import { fromBase64, toBase64 } from "@/lib/bytes";
import { decryptData, importPublicKey, wrapToPublicKey } from "@/lib/crypto";
import type { SetRow } from "./competition-client";

interface Device {
  id: string;
  name: string;
  activationCode: string | null;
  codeExpiresAt: string | null;
  pairedAt: string | null;
  sessionExpiresAt: string | null;
  lastSeenAt: string | null;
  publicKey: string | null;
  currentSetId: string | null;
  ackedSetId: string | null;
  ackedAt: string | null;
}

const DEFAULT_HOURS = 12;

/** Short relative time, e.g. "in 3h" or "expired". */
function until(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
}

const isExpired = (iso: string | null) => iso !== null && new Date(iso).getTime() <= Date.now();

const labelOf = (sets: SetRow[], setId: string) =>
  sets.find((set) => set.id === setId)?.label ?? "a set that has since been removed";

export default function Devices({
  competitionId,
  sets,
  competitionKey,
}: {
  competitionId: string;
  sets: SetRow[];
  competitionKey: CryptoKey | null;
}) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [allChoice, setAllChoice] = useState("");
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [name, setName] = useState("");
  const [hours, setHours] = useState(String(DEFAULT_HOURS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-renders so the countdowns stay honest without a reload.
  const [, setTick] = useState(0);

  async function refresh() {
    const response = await fetch(`/api/competitions/${competitionId}/devices`);
    if (!response.ok) return;
    const body = (await response.json()) as { devices: Device[] };
    setDevices(body.devices);
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/competitions/${competitionId}/devices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), sessionHours: Number(hours) }),
      });
      if (!response.ok) {
        setError("Could not add that device.");
        return;
      }
      setName("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(device: Device) {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/competitions/${competitionId}/devices/${device.id}`, {
        method: "DELETE",
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function extend(device: Device) {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/competitions/${competitionId}/devices/${device.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionHours: DEFAULT_HOURS }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  /**
   * The set key is unwrapped here and re-wrapped to this device's public key. The server
   * relays the wrapper and never sees the key itself.
   */
  async function push(device: Device, setId: string | null) {
    if (!device.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      let wrappedSetKey: string | null = null;

      if (setId !== null) {
        if (!competitionKey) {
          setError("This browser's key is not ready yet.");
          return;
        }
        const set = sets.find((candidate) => candidate.id === setId);
        if (!set) return;

        const setKey = await decryptData(competitionKey, fromBase64(set.wrappedSetKey));
        wrappedSetKey = toBase64(
          await wrapToPublicKey(setKey, await importPublicKey(fromBase64(device.publicKey))),
        );
      }

      const response = await fetch(
        `/api/competitions/${competitionId}/devices/${device.id}/push`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ setId, wrappedSetKey }),
        },
      );
      if (!response.ok) {
        setError(`Could not reach ${device.name}. Is it still paired?`);
        return;
      }
      await refresh();
    } catch {
      setError("Could not push that set.");
    } finally {
      setBusy(false);
    }
  }

  async function pushToAll(setId: string | null) {
    for (const device of devices ?? []) {
      if (device.pairedAt && !isExpired(device.sessionExpiresAt)) await push(device, setId);
    }
  }

  function status(device: Device): string {
    if (device.activationCode) {
      return isExpired(device.codeExpiresAt)
        ? "Code expired — remove and add again"
        : `Waiting for the device — code expires ${until(device.codeExpiresAt)}`;
    }
    if (isExpired(device.sessionExpiresAt)) return "Session expired";
    return `Paired — session ends ${until(device.sessionExpiresAt)}`;
  }

  return (
    <div className="card stack">
      <h2>Display devices</h2>

      {devices === null ? <p className="muted">Loading…</p> : null}
      {devices?.length === 0 ? <p className="muted">None yet.</p> : null}

      {devices?.map((device) => (
        <div key={device.id} className="listitem">
          <div style={{ minWidth: 0 }}>
            <div>{device.name}</div>
            <div className="muted" style={{ fontSize: "0.875rem" }}>
              {status(device)}
            </div>
            {device.activationCode && !isExpired(device.codeExpiresAt) ? (
              <p className="phrase mono" style={{ marginTop: "0.5rem" }}>
                {device.activationCode}
              </p>
            ) : null}

            {/* What the device says it is showing, not what we asked it to show. */}
            {device.pairedAt && !isExpired(device.sessionExpiresAt) ? (
              <>
                <div style={{ marginTop: "0.5rem" }}>
                  {device.ackedSetId
                    ? `Showing: ${labelOf(sets, device.ackedSetId)}`
                    : "Screen is clear"}
                  {device.currentSetId !== device.ackedSetId ? " · not confirmed yet" : ""}
                </div>
                <div className="row" style={{ marginTop: "0.5rem", flexWrap: "wrap" }}>
                  <select
                    className="input"
                    style={{ maxWidth: "18rem" }}
                    value={chosen[device.id] ?? ""}
                    onChange={(event) =>
                      setChosen({ ...chosen, [device.id]: event.target.value })
                    }
                  >
                    <option value="">Choose a scramble set…</option>
                    {sets.map((set) => (
                      <option key={set.id} value={set.id}>
                        {set.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button button--primary"
                    onClick={() => void push(device, chosen[device.id] ?? null)}
                    disabled={busy || !chosen[device.id]}
                  >
                    Show
                  </button>
                  <button
                    className="button button--danger"
                    onClick={() => void push(device, null)}
                    disabled={busy || !device.ackedSetId}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : null}
          </div>
          <div className="row">
            {device.pairedAt ? (
              <button className="button" onClick={() => void extend(device)} disabled={busy}>
                Extend
              </button>
            ) : null}
            <button
              className="button button--danger"
              onClick={() => void remove(device)}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      {(devices ?? []).some((d) => d.pairedAt && !isExpired(d.sessionExpiresAt)) ? (
        <div className="listitem stack" style={{ gap: "0.75rem" }}>
          <div>All devices at once</div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <select
              className="input"
              style={{ maxWidth: "18rem" }}
              value={allChoice}
              onChange={(event) => setAllChoice(event.target.value)}
            >
              <option value="">Choose a scramble set…</option>
              {sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.label}
                </option>
              ))}
            </select>
            <button
              className="button button--primary"
              onClick={() => void pushToAll(allChoice)}
              disabled={busy || !allChoice}
            >
              Show on all
            </button>
            <button
              className="button button--danger"
              onClick={() => void pushToAll(null)}
              disabled={busy}
            >
              Clear all
            </button>
          </div>
        </div>
      ) : null}

      <div className="listitem stack" style={{ gap: "0.75rem" }}>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Device name, e.g. Scrambling table 1"
          maxLength={60}
          autoComplete="off"
        />
        <label className="stack" style={{ gap: "0.375rem" }}>
          <span className="muted" style={{ fontSize: "0.875rem" }}>
            Session length in hours
          </span>
          <input
            className="input"
            type="number"
            min={1}
            max={72}
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
        </label>
        <div>
          <button
            className="button"
            onClick={() => void add()}
            disabled={busy || name.trim().length === 0}
          >
            Add device
          </button>
        </div>
      </div>

      {error ? (
        <div className="notice">
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
