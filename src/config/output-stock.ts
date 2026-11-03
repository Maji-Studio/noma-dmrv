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

/**
 * Wet estimates are whole kilograms. They are computed at an entered moisture,
 * not weighed, so a decimal would claim a precision the figure does not have.
 */
export const WET_ESTIMATE_DIGITS = 0;

/** Half of the last displayed digit: below it, a figure rounds to nothing. */
const HALF_UNIT = 1 / 2;

/**
 * A bin whose wet estimate (or a lane total, shown in whole kilograms) is below
 * this reads "Empty": it would render as "0 kg". Derived from the figure's own
 * precision. Figures shown at one decimal (feedstock wet mass, dry biochar)
 * follow the formatter's rounds-to-zero rule instead (`isMassEmpty`). Display
 * only: the stored stock is never trimmed.
 */
export const WET_ESTIMATE_DISPLAY_MIN_KG = HALF_UNIT * 10 ** -WET_ESTIMATE_DIGITS;
