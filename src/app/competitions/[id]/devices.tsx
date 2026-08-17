"use client";

import { useEffect, useState } from "react";

interface Device {
  id: string;
  name: string;
  activationCode: string | null;
  codeExpiresAt: string | null;
  pairedAt: string | null;
  sessionExpiresAt: string | null;
  lastSeenAt: string | null;
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

export default function Devices({ competitionId }: { competitionId: string }) {
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
