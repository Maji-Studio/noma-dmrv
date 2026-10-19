/**
 * A moisture reading further than this many percentage points from the
 * estimate raises an advisory warning. It never blocks the save (ADR 0026).
 */
export const MOISTURE_READING_WARNING_POINTS = 5;

/** Movements a sub-bin's ⓘ lists, newest first. The full log is the bin's history. */
export const SUB_BIN_RECENT_MOVEMENTS = 3;

/**
 * Whether biochar drawn pro-rata from a mix bin may feed credit batches. Off
 * until the PDD describes the mixing practice, how a pile's homogeneity is
 * shown, and pro-rata attribution (ADR 0030). While off, such applications are
 * recorded as usual but held out of credit-batch slices.
 */
export const MIX_BIN_REMOVALS_CREDITABLE = false;

/** Below this a part of a bin's stock is rounding, not a row, band or key entry worth showing. */
export const STOCK_PART_MIN_KG = 0.05;
