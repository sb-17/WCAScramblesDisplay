"use client";

import { useEffect, useState } from "react";
import { fromBase64, toBase64 } from "@/lib/bytes";
import {
  encryptData,
  exportDataKey,
  generateDataKey,
  importDataKey,
  unwrapWithPrivateKey,
} from "@/lib/crypto";
import { loadIdentity } from "@/lib/identity-store";
import { parseScrambleZip, type ParsedScrambles } from "@/scrambles/parse";
import { packSet } from "@/scrambles/payload";
import Devices from "./devices";

export interface SetRow {
  id: string;
  label: string;
  eventName: string | null;
  roundNumber: number | null;
  setLetter: string | null;
  bytes: number;
  wrappedSetKey: string;
}

interface Detail {
  name: string;
  wcaCompetitionId: string | null;
  endsOn: string | null;
  canPush: boolean;
  wrappedCompetitionKey: string;
  sets: SetRow[];
}

const WARNING_TEXT: Record<string, string> = {
  "pdf-without-passcode": "no passcode in the archive — cannot be uploaded",
  "passcode-without-pdf": "passcode with no matching PDF",
  "unrecognised-label": "name not understood — uploaded, but unsorted",
};

/** Loose comparison, only to catch uploading a different competition's archive. */
const looseName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export default function CompetitionClient({
  competitionId,
  wcaUserId,
}: {
  competitionId: string;
  wcaUserId: number;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [keys, setKeys] = useState<CryptoKeyPair | null>(null);
  const [competitionKey, setCompetitionKey] = useState<CryptoKey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [parsed, setParsed] = useState<ParsedScrambles | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/competitions/${competitionId}`);
    if (!response.ok) {
      setLoadError("Competition not found, or you do not have access to it.");
      return;
    }
    setDetail((await response.json()) as Detail);
  }

  useEffect(() => {
    void (async () => {
      setKeys(await loadIdentity(wcaUserId));
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, wcaUserId]);

  // Unwrapped once and held in memory. Pushing a set needs it to reach the set key.
  useEffect(() => {
    if (!keys || !detail || competitionKey) return;
    void (async () => {
      try {
        setCompetitionKey(
          await importDataKey(
            await unwrapWithPrivateKey(fromBase64(detail.wrappedCompetitionKey), keys.privateKey),
          ),
        );
      } catch {
        setLoadError("This browser's key cannot open this competition.");
      }
    })();
  }, [keys, detail, competitionKey]);

  async function readArchive() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setParsed(null);
    try {
      setParsed(await parseScrambleZip(file, password));
    } catch (err) {
      const message = (err as Error).message ?? "";
      setError(
        /password/i.test(message)
          ? "That master password did not open the archive."
          : `Could not read the archive: ${message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!parsed || !keys || !detail) return;
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: parsed.sets.length });

    try {
      // Unwrapped here and never sent: the server holds only the wrapper.
      const competitionKey = await importDataKey(
        await unwrapWithPrivateKey(fromBase64(detail.wrappedCompetitionKey), keys.privateKey),
      );

      let done = 0;
      for (const set of parsed.sets) {
        const setKey = await generateDataKey();
        const ciphertext = await encryptData(setKey, packSet(set.pdfBytes, set.passcode));
        const wrappedSetKey = await encryptData(competitionKey, await exportDataKey(setKey));

        const response = await fetch(`/api/competitions/${competitionId}/sets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: set.label,
            eventName: set.identity?.event ?? null,
            roundNumber: set.identity?.round ?? null,
            setLetter: set.identity?.set ?? null,
            wrappedSetKey: toBase64(wrappedSetKey),
            ciphertext: toBase64(ciphertext),
          }),
        });

        if (!response.ok) {
          setError(
            `Stopped after ${done} of ${parsed.sets.length} sets. ` +
              "Uploading again will resume — sets already stored are simply replaced.",
          );
          return;
        }

        done += 1;
        setProgress({ done, total: parsed.sets.length });
      }

      setParsed(null);
      setFile(null);
      setPassword("");
      await refresh();
    } catch {
      setError("Could not encrypt or upload the archive.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (loadError) {
    return (
      <div className="notice">
        <p>{loadError}</p>
      </div>
    );
  }

  if (!detail) return <p className="muted">Loading…</p>;

  const nameMismatch =
    parsed !== null && looseName(parsed.competitionName) !== looseName(detail.name);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="stack" style={{ gap: "0.5rem" }}>
          <h1>{detail.name}</h1>
          <div>
            {detail.wcaCompetitionId ? (
              <span className="tag mono">{detail.wcaCompetitionId}</span>
            ) : (
              <span className="tag">Unofficial</span>
            )}
          </div>
        </div>
        <a className="tag" href="/dashboard">
          Back
        </a>
      </div>

      <Devices
        competitionId={competitionId}
        sets={detail.sets}
        competitionKey={competitionKey}
      />

      {!keys ? (
        <div className="notice">
          <p>
            This browser does not have your encryption key. Set it up on the{" "}
            <a href="/dashboard">dashboard</a> first.
          </p>
        </div>
      ) : (
        <div className="card stack">
          <h2>Upload scrambles</h2>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            The TNoodle zip. Nothing leaves your browser unencrypted.
          </p>

          <label className="filepicker">
            <input
              type="file"
              accept=".zip"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setParsed(null);
              }}
            />
            <span className="button">Choose file</span>
            <span className="filename" data-chosen={file !== null}>
              {file?.name ?? "No file chosen"}
            </span>
          </label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Master password"
            autoComplete="off"
          />

          {parsed === null ? (
            <div>
              <button
                className="button"
                onClick={() => void readArchive()}
                disabled={busy || !file || password.length === 0}
              >
                {busy ? "Reading…" : "Read archive"}
              </button>
            </div>
          ) : (
            <>
              <div className="listitem">
                <div>
                  <div>{parsed.competitionName}</div>
                  <div className="muted" style={{ fontSize: "0.875rem" }}>
                    {parsed.sets.length} scramble set{parsed.sets.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              {nameMismatch ? (
                <div className="notice">
                  <p>
                    This archive is named “{parsed.competitionName}”, but this competition is
                    “{detail.name}”. Check it is the right archive before uploading.
                  </p>
                </div>
              ) : null}

              {parsed.warnings.length > 0 ? (
                <div className="stack" style={{ gap: "0.375rem" }}>
                  {parsed.warnings.map((warning) => (
                    <div key={`${warning.kind}-${warning.label}`} className="muted"
                      style={{ fontSize: "0.875rem" }}>
                      {warning.label} — {WARNING_TEXT[warning.kind] ?? warning.kind}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="row">
                <button
                  className="button button--primary"
                  onClick={() => void upload()}
                  disabled={busy || parsed.sets.length === 0}
                >
                  {progress
                    ? `Uploading ${progress.done} of ${progress.total}…`
                    : `Upload ${parsed.sets.length} set${parsed.sets.length === 1 ? "" : "s"}`}
                </button>
                <button className="button" onClick={() => setParsed(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {error ? (
            <div className="notice">
              <p>{error}</p>
            </div>
          ) : null}
        </div>
      )}

      {/* Last: this list runs to dozens of rows and would bury everything else. */}
      <div className="card stack">
        <h2>Scramble sets</h2>
        {detail.sets.length === 0 ? (
          <p className="muted">None uploaded yet.</p>
        ) : (
          detail.sets.map((set) => (
            <div key={set.id} className="listitem">
              <div>{set.label}</div>
              <span className="tag">{Math.max(1, Math.round(set.bytes / 1024))} kB</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
