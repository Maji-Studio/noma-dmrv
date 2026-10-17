"use client";

import * as React from "react";

/**
 * Why the enclosing form cannot save, for example a record lock that has not
 * answered, could not be read, or arrived as Sent. A side sheet or an edit
 * dialog provides it; `FormActions` disables Save and explains why above the
 * buttons. `readOnly` also disables every field (the draft stays visible).
 * `Modal` resets it, so a dialog opened from a locked sheet keeps its own Save.
 */
export interface SubmitBlock {
  reason: string;
  /** `info` while a check is pending; `error` when the task is blocked. */
  tone: "info" | "error";
  readOnly: boolean;
  /** Re-runs the check in place, keeping the draft, under this label. */
  retry?: { label: string; run: () => void; running?: boolean };
}

export const SubmitBlockContext = React.createContext<SubmitBlock | null>(null);

export function useSubmitBlock(): SubmitBlock | null {
  return React.useContext(SubmitBlockContext);
}
