import { createHash, randomBytes } from "node:crypto";
import { db, rows, toBytea } from "./client";

/** Crockford base32 again: unambiguous when read off a phone and typed on a tablet. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;
const CODE_TTL_MINUTES = 30;

export interface DeviceRow {
  id: string;
  name: string;
  /** Present only while the device is still waiting to be paired. */
  activationCode: string | null;
  codeExpiresAt: string | null;
  pairedAt: string | null;
  sessionExpiresAt: string | null;
  lastSeenAt: string | null;
}

export function normaliseCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[^0-9A-Z]/g, "");
}

function generateCode(): string {
  // 32 divides 256 exactly, so indexing a random byte carries no modulo bias.
  return Array.from(
    randomBytes(CODE_LENGTH),
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
  ).join("");
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export async function createDevice(input: {
  competitionId: string;
  name: string;
  sessionHours: number;
  createdBy: number;
}): Promise<DeviceRow> {
  const sql = db();

  // A collision on the unique code is vanishingly unlikely but not impossible, and a
  // failed insert here would be a confusing error for the Delegate.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const inserted = await rows<DeviceRecord>(sql`
      insert into devices
        (competition_id, name, activation_code, code_expires_at, session_expires_at, created_by)
      values
        (${input.competitionId},
         ${input.name},
         ${code},
         now() + ${`${CODE_TTL_MINUTES} minutes`}::interval,
         now() + ${`${input.sessionHours} hours`}::interval,
         ${input.createdBy})
      on conflict (activation_code) do nothing
      returning id, name, activation_code, code_expires_at, paired_at,
                session_expires_at, last_seen_at
    `);

    const row = inserted[0];
    if (row) return toDevice(row);
  }

  throw new Error("Could not allocate an activation code");
}

export async function listDevices(competitionId: string): Promise<DeviceRow[]> {
  const sql = db();
  const found = await rows<DeviceRecord>(sql`
    select id, name, activation_code, code_expires_at, paired_at,
           session_expires_at, last_seen_at
      from devices
     where competition_id = ${competitionId}
     order by created_at
  `);
  return found.map(toDevice);
}

export async function deleteDevice(competitionId: string, deviceId: string): Promise<boolean> {
  const sql = db();
  const deleted = await rows(sql`
    delete from devices
     where id = ${deviceId} and competition_id = ${competitionId}
    returning id
  `);
  return deleted.length > 0;
}

export async function extendSession(
  competitionId: string,
  deviceId: string,
  hours: number,
): Promise<boolean> {
  const sql = db();
  const updated = await rows(sql`
    update devices
       set session_expires_at = now() + ${`${hours} hours`}::interval
     where id = ${deviceId} and competition_id = ${competitionId} and paired_at is not null
    returning id
  `);
  return updated.length > 0;
}

export interface ClaimedDevice {
  deviceId: string;
  deviceName: string;
  competitionId: string;
  competitionName: string;
  token: string;
  sessionExpiresAt: string;
}

/**
 * Exchanges a one-time code for a device session. The code is cleared in the same
 * statement that claims it, so two devices racing on the same code cannot both win.
 */
export async function claimDevice(
  code: string,
  publicKey: Uint8Array,
): Promise<ClaimedDevice | null> {
  const sql = db();
  const token = randomBytes(32).toString("base64url");

  const claimed = await rows<{
    id: string;
    name: string;
    competition_id: string;
    session_expires_at: string;
  }>(sql`
    update devices
       set activation_code = null,
           code_expires_at = null,
           public_key = ${toBytea(publicKey)},
           token_hash = ${hashToken(token)},
           paired_at = now(),
           last_seen_at = now()
     where activation_code = ${normaliseCode(code)}
       and code_expires_at > now()
    returning id, name, competition_id, session_expires_at
  `);

  const row = claimed[0];
  if (!row) return null;

  const competition = await rows<{ name: string }>(sql`
    select name from competitions where id = ${row.competition_id}
  `);

  return {
    deviceId: row.id,
    deviceName: row.name,
    competitionId: row.competition_id,
    competitionName: competition[0]?.name ?? "",
    token,
    sessionExpiresAt: row.session_expires_at,
  };
}

interface DeviceRecord {
  id: string;
  name: string;
  activation_code: string | null;
  code_expires_at: string | null;
  paired_at: string | null;
  session_expires_at: string | null;
  last_seen_at: string | null;
}

function toDevice(row: DeviceRecord): DeviceRow {
  return {
    id: row.id,
    name: row.name,
    activationCode: row.activation_code,
    codeExpiresAt: row.code_expires_at,
    pairedAt: row.paired_at,
    sessionExpiresAt: row.session_expires_at,
    lastSeenAt: row.last_seen_at,
  };
}
