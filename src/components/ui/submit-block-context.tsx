"use client";

import * as React from "react";

/**
 * Why the enclosing form's Save is off, for example a record lock that has
 * not answered or arrived as Sent. A side sheet or an edit dialog provides
 * it; `FormActions` disables Save and shows the reason, keeping the draft.
 * `Modal` resets it, so a dialog opened from a locked sheet keeps its own Save.
 */
export const SubmitBlockContext = React.createContext<string | null>(null);

export function useSubmitBlockedReason(): string | null {
  return React.useContext(SubmitBlockContext);
}
