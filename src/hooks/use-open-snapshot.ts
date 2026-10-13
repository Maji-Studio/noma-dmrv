/**
 * useOpenSnapshot — the record an edit dialog was opened on, held still until
 * the dialog closes and opens again.
 *
 * A refetch of the record while the dialog is open (a background refresh, or
 * the invalidation after a stale save) must not replace the loaded version or
 * remount the form, or the operator's draft is lost. Key the form by
 * `sessionKey`: it changes only when the dialog opens, or opens on another
 * record.
 */
"use client";

import { useState } from "react";

interface SnapshotState<T> {
  isOpen: boolean;
  snapshot: T | null;
  session: number;
}

export function useOpenSnapshot<T extends { id: string }>(
  isOpen: boolean,
  value: T | null | undefined,
): { snapshot: T | null; sessionKey: string } {
  const [state, setState] = useState<SnapshotState<T>>({
    isOpen,
    snapshot: isOpen ? value ?? null : null,
    session: 0,
  });

  let current = state;
  const opened = isOpen && !state.isOpen;
  const switchedRecord = isOpen && (value?.id ?? null) !== (state.snapshot?.id ?? null);
  if (opened || switchedRecord) {
    current = { isOpen, snapshot: value ?? null, session: state.session + 1 };
    setState(current);
  } else if (!isOpen && state.isOpen) {
    // Keep the closed snapshot so the dialog keeps its edit title while it closes.
    current = { ...state, isOpen };
    setState(current);
  }

  return {
    snapshot: current.snapshot,
    sessionKey: `${current.snapshot?.id ?? "new"}:${current.session}`,
  };
}
