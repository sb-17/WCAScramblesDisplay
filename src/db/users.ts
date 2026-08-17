import { db, fromBytea, rows, toBytea } from "./client";

export interface Identity {
  publicKey: Uint8Array<ArrayBuffer>;
  recoverySalt: Uint8Array<ArrayBuffer>;
  recoveryBlob: Uint8Array<ArrayBuffer>;
}

export async function upsertUser(user: {
  wcaUserId: number;
  name: string;
  wcaId: string | null;
  delegateStatus: string;
}): Promise<void> {
  const sql = db();
  await sql`
    insert into users (wca_user_id, name, wca_id, delegate_status)
    values (${user.wcaUserId}, ${user.name}, ${user.wcaId}, ${user.delegateStatus})
    on conflict (wca_user_id) do update
      set name = excluded.name,
          wca_id = excluded.wca_id,
          delegate_status = excluded.delegate_status,
          updated_at = now()
  `;
}

export async function getIdentity(wcaUserId: number): Promise<Identity | null> {
  const sql = db();
  const found = await rows<{
    public_key: unknown;
    recovery_salt: unknown;
    recovery_blob: unknown;
  }>(sql`
    select public_key, recovery_salt, recovery_blob
    from users where wca_user_id = ${wcaUserId}
  `);

  const row = found[0];
  if (!row?.public_key) return null;

  return {
    publicKey: fromBytea(row.public_key),
    recoverySalt: fromBytea(row.recovery_salt),
    recoveryBlob: fromBytea(row.recovery_blob),
  };
}

/**
 * Refuses to overwrite an identity that already exists. A second browser must recover the
 * original key rather than publish a new one -- replacing the public key would orphan
 * every competition key already wrapped to the old one, locking the Delegate out of their
 * own scrambles with no way back.
 */
export async function claimIdentity(wcaUserId: number, identity: Identity): Promise<boolean> {
  const sql = db();
  const claimed = await rows(sql`
    update users
       set public_key = ${toBytea(identity.publicKey)},
           recovery_salt = ${toBytea(identity.recoverySalt)},
           recovery_blob = ${toBytea(identity.recoveryBlob)},
           updated_at = now()
     where wca_user_id = ${wcaUserId}
       and public_key is null
    returning wca_user_id
  `);
  return claimed.length > 0;
}
