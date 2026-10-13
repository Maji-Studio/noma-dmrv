"use client";

import { createContext } from "react";

export interface DialogFormState {
  dirty: boolean;
  busy: boolean;
}

/** Each form registers separately so saving one cannot clear another's draft. */
export const FormDialogContext = createContext<{
  report: (id: object, state: DialogFormState | null) => void;
  cancel: () => void;
  markSaved: (id: object) => void;
} | null>(null);
