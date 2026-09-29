/**
 * A moisture reading further than this many percentage points from the
 * estimate raises an advisory warning. It never blocks the save (ADR 0026).
 */
export const MOISTURE_READING_WARNING_POINTS = 5;

/** A split bin shows its sub-bins as cards up to this many, then as rows. */
export const SUB_BIN_CARD_LIMIT = 6;

/** Movements a sub-bin's ⓘ lists, newest first. The full log is the bin's history. */
export const SUB_BIN_RECENT_MOVEMENTS = 3;
