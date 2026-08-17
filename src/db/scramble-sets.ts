import { db, fromBytea, rows, toBytea } from "./client";

export interface ScrambleSetRow {
  id: string;
  label: string;
  eventName: string | null;
  roundNumber: number | null;
  setLetter: string | null;
  bytes: number;
  /** Set key under the competition key. Only a Delegate holding that key can open it. */
  wrappedSetKey: Uint8Array<ArrayBuffer>;
}

export interface ScrambleSetInput {
  competitionId: string;
  label: string;
  eventName: string | null;
  roundNumber: number | null;
  setLetter: string | null;
  wrappedSetKey: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Upserts on (competition_id, label) so re-uploading a corrected archive replaces the set
 * rather than failing halfway through. Uploads happen one set per request, which keeps each
 * body small and lets an interrupted upload be resumed by simply running it again.
 */
export async function putScrambleSet(input: ScrambleSetInput): Promise<void> {
  const sql = db();
  await sql`
    insert into scramble_sets
      (competition_id, label, event_name, round_number, set_letter, wrapped_set_key, ciphertext)
    values
      (${input.competitionId}, ${input.label}, ${input.eventName}, ${input.roundNumber},
       ${input.setLetter}, ${toBytea(input.wrappedSetKey)}, ${toBytea(input.ciphertext)})
    on conflict (competition_id, label) do update
      set event_name = excluded.event_name,
          round_number = excluded.round_number,
          set_letter = excluded.set_letter,
          wrapped_set_key = excluded.wrapped_set_key,
          ciphertext = excluded.ciphertext
  `;
}

export async function listScrambleSets(competitionId: string): Promise<ScrambleSetRow[]> {
  const sql = db();
  const found = await rows<{
    id: string;
    label: string;
    event_name: string | null;
    round_number: number | null;
    set_letter: string | null;
    bytes: string;
    wrapped_set_key: unknown;
  }>(sql`
    select id, label, event_name, round_number, set_letter,
           length(ciphertext) as bytes, wrapped_set_key
      from scramble_sets
     where competition_id = ${competitionId}
     order by event_name nulls last, round_number nulls last, set_letter nulls last, label
  `);

  return found.map((row) => ({
    id: row.id,
    label: row.label,
    eventName: row.event_name,
    roundNumber: row.round_number,
    setLetter: row.set_letter,
    bytes: Number(row.bytes),
    wrappedSetKey: fromBytea(row.wrapped_set_key),
  }));
}

/** The encrypted set itself, for a display device to cache ahead of time. */
export async function getCiphertext(
  competitionId: string,
  setId: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const sql = db();
  const found = await rows<{ ciphertext: unknown }>(sql`
    select ciphertext from scramble_sets
     where id = ${setId} and competition_id = ${competitionId}
  `);

  const row = found[0];
  return row ? fromBytea(row.ciphertext) : null;
}
