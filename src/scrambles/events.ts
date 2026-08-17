/**
 * Fewest Moves is out of scope: those scrambles are handed out on paper and will never be
 * shown on a display, so importing them only clutters the set list a Delegate picks from.
 *
 * Matched on the event name rather than a fixed label so it holds regardless of how the
 * round and set are numbered, and it catches the abbreviation too.
 */
const FEWEST_MOVES = /fewest\s*moves|\bfmc\b/i;

export function isFewestMoves(label: string): boolean {
  return FEWEST_MOVES.test(label);
}
