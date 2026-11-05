/** Fills and strokes the Sankey waterfall and the Allocation flow chart share, so they read as siblings. */
import type { CSSProperties } from "react";

export const LIT_FILL = "var(--acc-dist)";
export const LIT_INK = "var(--acc-dist-ink)";
export const START_FILL = "var(--clr-dark-purple-5)";
export const START_STROKE = "var(--clr-dark-purple-40)";
export const HATCH_STROKE = "var(--clr-dark-purple-40)";

/** The water hatch as CSS, for HTML bars. */
export const HATCH_BACKGROUND: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--clr-dark-purple-40) 0 1px, transparent 1px 5px)",
};
