import { createHash, randomBytes } from "node:crypto";
import { db, fromBytea, rows, toBytea } from "./client";

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
  /** Needed by the Delegate's browser to wrap a set key to this device. */
  publicKey: Uint8Array<ArrayBuffer> | null;
  /** What was sent, versus what the device says it is actually showing. */
  currentSetId: string | null;
  ackedSetId: string | null;
  ackedAt: string | null;
  /** False while the set is on screen but covered, waiting for a scrambler to confirm it. */
  ackedConfirmed: boolean;
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
                session_expires_at, last_seen_at, public_key, acked_confirmed,
                current_set_id, acked_set_id, acked_at
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
           session_expires_at, last_seen_at, public_key, acked_confirmed,
           current_set_id, acked_set_id, acked_at
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

export interface AuthenticatedDevice {
  deviceId: string;
  deviceName: string;
  competitionId: string;
  publicKey: Uint8Array<ArrayBuffer>;
}

/**
 * Authenticates a display device by its bearer token. An expired session fails exactly like
 * a bad token: the device is simply no longer allowed to ask for anything.
 */
export async function authenticateDevice(
  request: Request,
): Promise<AuthenticatedDevice | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  const sql = db();
  const found = await rows<{
    id: string;
    name: string;
    competition_id: string;
    public_key: unknown;
  }>(sql`
    select id, name, competition_id, public_key
      from devices
     where token_hash = ${hashToken(token)}
       and session_expires_at > now()
  `);

  const row = found[0];
  if (!row) return null;

  await sql`update devices set last_seen_at = now() where id = ${row.id}`;

  return {
    deviceId: row.id,
    deviceName: row.name,
    competitionId: row.competition_id,
    publicKey: fromBytea(row.public_key),
  };
}

export interface DeviceState {
  setId: string | null;
  label: string | null;
  wrappedSetKey: Uint8Array<ArrayBuffer> | null;
  pushedAt: string | null;
}

export async function readDeviceState(deviceId: string): Promise<DeviceState | null> {
  const sql = db();
  const found = await rows<{
    current_set_id: string | null;
    current_wrapped_key: unknown;
    pushed_at: string | null;
    label: string | null;
  }>(sql`
    select d.current_set_id, d.current_wrapped_key, d.pushed_at, s.label
      from devices d
      left join scramble_sets s on s.id = d.current_set_id
     where d.id = ${deviceId}
  `);

  const row = found[0];
  if (!row) return null;

  return {
    setId: row.current_set_id,
    label: row.label,
    wrappedSetKey: row.current_wrapped_key ? fromBytea(row.current_wrapped_key) : null,
    pushedAt: row.pushed_at,
  };
}

/**
 * A device reports twice for each push: once when it has the set decrypted and covered, and
 * again when a scrambler has confirmed it. The Delegate's phone distinguishes the two, so
 * "on its way", "waiting to be confirmed" and "on screen" are never conflated.
 */
export async function acknowledgeState(
  deviceId: string,
  setId: string | null,
  confirmed: boolean,
): Promise<void> {
  const sql = db();
  await sql`
    update devices
       set acked_set_id = ${setId},
           acked_confirmed = ${confirmed},
           acked_at = now(),
           last_seen_at = now()
     where id = ${deviceId}
  `;
}

/**
 * Pushes a set to a device, or clears its screen when setId is null. The previous wrapped
 * key is overwritten either way, so the device loses access to whatever it was showing.
 */
export async function pushToDevice(input: {
  competitionId: string;
  deviceId: string;
  setId: string | null;
  wrappedSetKey: Uint8Array | null;
  pushedBy: number;
}): Promise<boolean> {
  const sql = db();
  const updated = await rows<{ name: string }>(sql`
    update devices
       set current_set_id = ${input.setId},
           current_wrapped_key = ${input.wrappedSetKey ? toBytea(input.wrappedSetKey) : null},
           pushed_at = now()
     where id = ${input.deviceId}
       and competition_id = ${input.competitionId}
       and paired_at is not null
       and session_expires_at > now()
    returning name
  `);

  const device = updated[0];
  if (!device) return false;

  const label = input.setId
    ? await rows<{ label: string }>(sql`
        select label from scramble_sets where id = ${input.setId}
      `)
    : [];

  await sql`
    insert into push_log (competition_id, device_name, set_label, pushed_by)
    values (${input.competitionId}, ${device.name}, ${label[0]?.label ?? null}, ${input.pushedBy})
  `;

  return true;
}

interface DeviceRecord {
  id: string;
  name: string;
  activation_code: string | null;
  code_expires_at: string | null;
  paired_at: string | null;
  session_expires_at: string | null;
  last_seen_at: string | null;
  public_key: unknown;
  current_set_id: string | null;
  acked_set_id: string | null;
  acked_at: string | null;
  acked_confirmed: boolean;
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
    publicKey: row.public_key ? fromBytea(row.public_key) : null,
    currentSetId: row.current_set_id,
    ackedSetId: row.acked_set_id,
    ackedAt: row.acked_at,
    ackedConfirmed: row.acked_confirmed,
  };
}
