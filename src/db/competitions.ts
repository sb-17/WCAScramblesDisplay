import { db, fromBytea, rows, toBytea } from "./client";

export interface CompetitionSummary {
  id: string;
  /** Null for unofficial competitions, which have no WCA record to point at. */
  wcaCompetitionId: string | null;
  name: string;
  endsOn: string | null;
  canPush: boolean;
  setCount: number;
}

export class CompetitionTakenError extends Error {
  constructor(public readonly ownerName: string) {
    super("Competition is already set up");
  }
}

/**
 * Creates the competition and grants the creator access in one go. Both rows are written
 * together because a competition nobody can open is useless -- if the access row were lost,
 * the competition key would have no wrapper and the scrambles would be unreachable.
 */
export async function createCompetition(input: {
  wcaCompetitionId: string | null;
  name: string;
  endsOn: string | null;
  createdBy: number;
  wrappedCompetitionKey: Uint8Array;
}): Promise<string> {
  const sql = db();

  // Only WCA competitions can collide. Unofficial ones are personal to their creator, so
  // two Delegates each running a "Thursday Practice" is expected, not a conflict.
  if (input.wcaCompetitionId !== null) {
    const existing = await rows<{ name: string }>(sql`
      select u.name
        from competitions c
        join users u on u.wca_user_id = c.created_by
       where c.wca_competition_id = ${input.wcaCompetitionId}
    `);
    if (existing[0]) throw new CompetitionTakenError(existing[0].name);
  }

  const created = await rows<{ id: string }>(sql`
    insert into competitions (wca_competition_id, name, ends_on, created_by)
    values (${input.wcaCompetitionId}, ${input.name}, ${input.endsOn}, ${input.createdBy})
    returning id
  `);

  const competitionId = created[0]?.id;
  if (!competitionId) throw new Error("Competition insert returned no id");

  await sql`
    insert into competition_access
      (competition_id, wca_user_id, wrapped_competition_key, granted_by)
    values
      (${competitionId}, ${input.createdBy},
       ${toBytea(input.wrappedCompetitionKey)}, ${input.createdBy})
  `;

  return competitionId;
}

export async function listCompetitionsFor(wcaUserId: number): Promise<CompetitionSummary[]> {
  const sql = db();
  const found = await rows<{
    id: string;
    wca_competition_id: string | null;
    name: string;
    ends_on: string | null;
    can_push: boolean;
    set_count: string;
  }>(sql`
    select c.id,
           c.wca_competition_id,
           c.name,
           c.ends_on,
           a.can_push,
           count(s.id) as set_count
      from competition_access a
      join competitions c on c.id = a.competition_id
      left join scramble_sets s on s.competition_id = c.id
     where a.wca_user_id = ${wcaUserId}
     group by c.id, a.can_push
     order by c.ends_on desc nulls last, c.name
  `);

  return found.map((row) => ({
    id: row.id,
    wcaCompetitionId: row.wca_competition_id,
    name: row.name,
    endsOn: row.ends_on,
    canPush: row.can_push,
    setCount: Number(row.set_count),
  }));
}

/** Returns the competition key wrapped to this Delegate, or null if they have no access. */
export async function wrappedKeyFor(
  competitionId: string,
  wcaUserId: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const sql = db();
  const found = await rows<{ wrapped_competition_key: unknown }>(sql`
    select wrapped_competition_key
      from competition_access
     where competition_id = ${competitionId} and wca_user_id = ${wcaUserId}
  `);

  const row = found[0];
  return row ? fromBytea(row.wrapped_competition_key) : null;
}
