/**
 * Which bin movements are counts: a count, or a correction that replaced an
 * entry with a count. Only a count weighs the whole bin, so only its moisture
 * readings set wet stock and moisture; readings saved by older removals stay
 * history.
 */
import { binMovements } from '@/db/schema';
import { sql } from 'drizzle-orm';

const COUNT_KIND = 'count';
const REPLACEMENT_KIND = 'replacement';

/** SQL predicate on `binMovements`: the movement is a count. */
export function isCountMovementSql() {
  return sql`(${binMovements.outputKind} = ${COUNT_KIND} or (${binMovements.outputKind} = ${REPLACEMENT_KIND} and ${binMovements.inputSnapshot}->>'kind' = ${COUNT_KIND}))`;
}

/** The same predicate on a loaded movement row. */
export function isCountMovement(movement: { outputKind: string | null; inputSnapshot: { kind?: unknown } | null }): boolean {
  return movement.outputKind === COUNT_KIND || (movement.outputKind === REPLACEMENT_KIND && movement.inputSnapshot?.kind === COUNT_KIND);
}
