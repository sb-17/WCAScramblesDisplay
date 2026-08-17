import { db, fromBytea, rows, toBytea } from "./client";

export interface DelegateAccess {
  wcaUserId: number;
  name: string;
  wcaId: string | null;
  canPush: boolean;
  isOwner: boolean;
}

export interface DelegateCandidate {
  wcaUserId: number;
  name: string;
  wcaId: string | null;
  publicKey: Uint8Array<ArrayBuffer>;
}

export async function isOwnerOf(competitionId: string, wcaUserId: number): Promise<boolean> {
  const sql = db();
  const found = await rows(sql`
    select 1 from competitions
     where id = ${competitionId} and created_by = ${wcaUserId}
  `);
  return found.length > 0;
}

export async function listAccess(competitionId: string): Promise<DelegateAccess[]> {
  const sql = db();
  const found = await rows<{
    wca_user_id: number;
    name: string;
    wca_id: string | null;
    can_push: boolean;
    is_owner: boolean;
  }>(sql`
    select u.wca_user_id, u.name, u.wca_id, a.can_push,
           c.created_by = u.wca_user_id as is_owner
      from competition_access a
      join users u on u.wca_user_id = a.wca_user_id
      join competitions c on c.id = a.competition_id
     where a.competition_id = ${competitionId}
     order by is_owner desc, u.name
  `);

  return found.map((row) => ({
    wcaUserId: row.wca_user_id,
    name: row.name,
    wcaId: row.wca_id,
    canPush: row.can_push,
    isOwner: row.is_owner,
  }));
}

/**
 * Only Delegates who have signed in and published a public key can be found, because the
 * competition key has to be wrapped to that key. Somebody who has never opened the app has
 * nothing to wrap to, so offering them would produce an invitation that cannot be honoured.
 */
export async function searchDelegates(
  query: string,
  competitionId: string,
): Promise<DelegateCandidate[]> {
  const sql = db();
  const like = `%${query}%`;
  const found = await rows<{
    wca_user_id: number;
    name: string;
    wca_id: string | null;
    public_key: unknown;
  }>(sql`
    select wca_user_id, name, wca_id, public_key
      from users
     where public_key is not null
       and (name ilike ${like} or wca_id ilike ${like})
       and wca_user_id not in (
         select wca_user_id from competition_access where competition_id = ${competitionId}
       )
     order by name
     limit 10
  `);

  return found.map((row) => ({
    wcaUserId: row.wca_user_id,
    name: row.name,
    wcaId: row.wca_id,
    publicKey: fromBytea(row.public_key),
  }));
}

export async function grantAccess(input: {
  competitionId: string;
  wcaUserId: number;
  wrappedCompetitionKey: Uint8Array;
  canPush: boolean;
  grantedBy: number;
}): Promise<void> {
  const sql = db();
  await sql`
    insert into competition_access
      (competition_id, wca_user_id, wrapped_competition_key, can_push, granted_by)
    values
      (${input.competitionId}, ${input.wcaUserId},
       ${toBytea(input.wrappedCompetitionKey)}, ${input.canPush}, ${input.grantedBy})
    on conflict (competition_id, wca_user_id) do update
      set wrapped_competition_key = excluded.wrapped_competition_key,
          can_push = excluded.can_push
  `;
}

/**
 * Deleting the row removes the only wrapper of the competition key for that Delegate, so
 * the key is simply gone for them. The creator is excluded: removing them would leave a
 * competition nobody owns.
 */
export async function revokeAccess(
  competitionId: string,
  wcaUserId: number,
): Promise<boolean> {
  const sql = db();
  const removed = await rows(sql`
    delete from competition_access a
     using competitions c
     where a.competition_id = ${competitionId}
       and a.wca_user_id = ${wcaUserId}
       and c.id = a.competition_id
       and c.created_by <> ${wcaUserId}
    returning a.wca_user_id
  `);
  return removed.length > 0;
}
