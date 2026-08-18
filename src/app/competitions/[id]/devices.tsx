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
  ackedConfirmed: boolean;
  cachedSetIds: string[] | null;
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

/**
 * A device that has never reported is treated as holding everything, so one paired before
 * cache reporting existed is not left unable to receive anything.
 */
const holds = (device: Device, setId: string) =>
  device.cachedSetIds === null || device.cachedSetIds.includes(setId);

const stillDownloading = (device: Device, total: number) =>
  device.cachedSetIds !== null && device.cachedSetIds.length < total;

const labelOf = (sets: SetRow[], setId: string) =>
  sets.find((set) => set.id === setId)?.label ?? "a set that has since been removed";

/**
 * While a push is in flight, report what is on its way rather than the state the device has
 * not caught up from. Showing the stale value with a caveat appended reads as though the
 * old set is still up, which is the opposite of what is happening.
 */
function showingLine(device: Device, sets: SetRow[]): string {
  if (device.currentSetId !== device.ackedSetId) {
    return device.currentSetId
      ? `Sending ${labelOf(sets, device.currentSetId)}…`
      : "Clearing the screen…";
  }
  if (!device.ackedSetId) return "Screen is clear";
  if (!device.ackedConfirmed) {
    return `Waiting for the scrambler to confirm ${labelOf(sets, device.ackedSetId)}`;
  }
  return `Showing: ${labelOf(sets, device.ackedSetId)}`;
}

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
  /**
   * Which push is awaiting the Delegate's own confirmation: a device id, or "all".
   *
   * The confirm button repeats the set name rather than saying "Confirm", so it has to be
   * read to be acted on. This catches a mis-tap; the scrambler's confirmation on the display
   * catches the different error of picking the wrong group deliberately.
   */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [name, setName] = useState("");
  const [hours, setHours] = useState(String(DEFAULT_HOURS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/competitions/${competitionId}/devices`);
    if (!response.ok) return;
    const body = (await response.json()) as { devices: Device[] };
    setDevices(body.devices);
  }

  // A device can take a poll cycle to acknowledge, so keep checking until it has. Faster
  // while something is in flight, and slow enough otherwise to keep the countdowns honest.
  const liveDevices = (devices ?? []).filter(
    (device) => device.pairedAt !== null && !isExpired(device.sessionExpiresAt),
  );

  const awaitingAck = (devices ?? []).some(
    (device) => device.currentSetId !== device.ackedSetId || !device.ackedConfirmed,
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), awaitingAck ? 2_000 : 10_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, awaitingAck]);

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
      if (response.status === 409) {
        const body = (await response.json()) as { error?: string };
        setError(
          body.error === "not-downloaded"
            ? `${device.name} has not downloaded that set yet. It will be available shortly.`
            : `${device.name} is not available. Is it still paired?`,
        );
        return;
      }
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

      {devices?.map((device) => {
        const live = device.pairedAt !== null && !isExpired(device.sessionExpiresAt);
        return (
          <div key={device.id} className="block">
            <div className="block-head">
              <div style={{ minWidth: 0 }}>
                <div>{device.name}</div>
                <div className="muted" style={{ fontSize: "0.875rem" }}>
                  {status(device)}
                </div>
              </div>
              <div className="row">
                {live ? (
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => void push(device, null)}
                    disabled={busy || !device.ackedSetId}
                  >
                    Clear
                  </button>
                ) : null}
                {device.pairedAt ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => void extend(device)}
                    disabled={busy}
                  >
                    Extend
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => void remove(device)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            </div>

            {device.activationCode && !isExpired(device.codeExpiresAt) ? (
              <p className="phrase mono">{device.activationCode}</p>
            ) : null}

            {/* What the device says it is showing, not what we asked it to show. */}
            {live ? (
              <>
                <div>{showingLine(device, sets)}</div>
                {stillDownloading(device, sets.length) ? (
                  <div className="muted" style={{ fontSize: "0.875rem" }}>
                    Downloading scrambles — {device.cachedSetIds?.length ?? 0} of {sets.length}
                  </div>
                ) : null}
                <div className="controls">
                  <select
                    className="input"
                    value={chosen[device.id] ?? ""}
                    disabled={confirming === device.id}
                    onChange={(event) => {
                      setConfirming(null);
                      setChosen({ ...chosen, [device.id]: event.target.value });
                    }}
                  >
                    <option value="">Choose a scramble set…</option>
                    {sets.map((set) => (
                      <option key={set.id} value={set.id} disabled={!holds(device, set.id)}>
                        {set.label}
                        {holds(device, set.id) ? "" : " — not downloaded yet"}
                      </option>
                    ))}
                  </select>
                  {confirming === device.id ? (
                    <>
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={() => {
                          setConfirming(null);
                          void push(device, chosen[device.id] ?? null);
                        }}
                        disabled={busy}
                      >
                        Send {labelOf(sets, chosen[device.id] ?? "")}
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => setConfirming(device.id)}
                      disabled={busy || !chosen[device.id]}
                    >
                      Show
                    </button>
                  )}
                </div>
              </>
            ) : null}
          </div>
        );
      })}

      {liveDevices.length > 0 ? (
        <div className="block">
          <div className="block-head">
            <div>All devices at once</div>
            <button
              type="button"
              className="button button--danger"
              onClick={() => void pushToAll(null)}
              disabled={busy}
            >
              Clear all
            </button>
          </div>
          <div className="controls">
            <select
              className="input"
              value={allChoice}
              disabled={confirming === "all"}
              onChange={(event) => {
                setConfirming(null);
                setAllChoice(event.target.value);
              }}
            >
              <option value="">Choose a scramble set…</option>
              {sets.map((set) => {
                const everywhere = liveDevices.every((device) => holds(device, set.id));
                return (
                  <option key={set.id} value={set.id} disabled={!everywhere}>
                    {set.label}
                    {everywhere ? "" : " — not on every screen yet"}
                  </option>
                );
              })}
            </select>
            {confirming === "all" ? (
              <>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    setConfirming(null);
                    void pushToAll(allChoice);
                  }}
                  disabled={busy}
                >
                  Send {labelOf(sets, allChoice)} to every screen
                </button>
                <button type="button" className="button" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button--primary"
                onClick={() => setConfirming("all")}
                disabled={busy || !allChoice}
              >
                Show on all
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="block">
        <div>Add a device</div>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Device name, e.g. Scrambling table 1"
          maxLength={60}
          autoComplete="off"
        />
        <div className="controls">
          <input
            className="input"
            type="number"
            min={1}
            max={72}
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            aria-label="Session length in hours"
            style={{ flex: "0 0 6rem" }}
          />
          <span className="muted" style={{ fontSize: "0.875rem" }}>
            hours
          </span>
          <button
            type="button"
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
