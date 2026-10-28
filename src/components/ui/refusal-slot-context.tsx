"use client";

import * as React from "react";

/**
 * Where a refusal goes once the form turned read-only (the record became
 * Sent): the top of the sheet or dialog, above the lock line, because the
 * footer with Save is gone. The container holds the element in a `useState`
 * ref callback, so the slot is known during render without an effect.
 * `FormActions` portals into it; with no slot it renders the box inline.
 */
export const RefusalSlotContext = React.createContext<HTMLElement | null>(null);

export function useRefusalSlot(): HTMLElement | null {
  return React.useContext(RefusalSlotContext);
}
