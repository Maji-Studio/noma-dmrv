/**
 * Side-sheet action context.
 *
 * Lets the sheet-level CTA row (`FormActions`) route Cancel through the sheet
 * instead of each list wiring its own handler: in edit mode Cancel returns to
 * the read view, in create mode it closes the sheet, and both paths pass the
 * sheet's dirty-state guard so typed work is never discarded silently.
 *
 * `Modal` re-provides `null` as a barrier: a centered dialog opened from
 * inside a sheet (quick-add forms, confirms) is its own interaction scope, so
 * its Cancel must never navigate the sheet underneath it.
 */
"use client";

import * as React from "react";

interface SideSheetActions {
  /** Guarded Cancel: edit mode returns to the read view, create mode closes. */
  cancel: () => void;
  /**
   * Authoritative dirty report from the form's own state (RHF
   * `formState.isDirty`). The sheet's native input/change heuristic misses
   * programmatic `setValue` from custom widgets (entity selects, radio cards,
   * pickers), so forms report the owner's verdict here and the guard uses
   * whichever says dirty.
   */
  reportDirty: (dirty: boolean) => void;
}

const SideSheetActionsContext = React.createContext<SideSheetActions | null>(
  null
);

function useSideSheetActions(): SideSheetActions | null {
  return React.useContext(SideSheetActionsContext);
}

export { SideSheetActionsContext, useSideSheetActions };
export type { SideSheetActions };
