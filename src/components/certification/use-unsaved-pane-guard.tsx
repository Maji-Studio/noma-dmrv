/**
 * useUnsavedPaneGuard — the unsaved-changes guard for a pane that is swapped
 * out in place (the Certification settings rail), as opposed to a sheet or
 * dialog that is closed.
 *
 * It reuses the dirty-reporting channel `FormDialog` already owns: `FormActions`
 * mirrors a form's authoritative RHF `isDirty` into `FormDialogContext`, so any
 * form rendered inside `actions` registers itself with no per-form wiring. The
 * leave itself is asked with the shared `DiscardChangesDialog`.
 *
 * The guard also registers itself app-wide (`@/lib/leave-guard`), so chrome
 * outside the pane, the sidebar organization switcher, asks the same dialog
 * before it leaves.
 *
 * Tab close and reload are covered with `beforeunload`. In-app route changes
 * are not: the App Router has no navigation-blocking API, and intercepting
 * every link click would be a second, fragile guard for one console.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { DiscardChangesDialog } from "@/components/ui/discard-changes-dialog";
import {
  FormDialogContext,
  type DialogFormState,
} from "@/components/ui/form-dialog-context";
import {
  isUnloadWarningSuppressed,
  registerLeaveGuard,
  type LeaveOptions,
} from "@/lib/leave-guard";

type DialogActions = NonNullable<React.ContextType<typeof FormDialogContext>>;

const DISCARD_DESCRIPTION =
  "This section has changes that are not saved. Leaving it discards them.";

export function useUnsavedPaneGuard() {
  const forms = useRef(new Map<object, DialogFormState>());
  const [dirty, setDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{
    leave: () => void;
    description: string;
  } | null>(null);

  const sync = () =>
    setDirty([...forms.current.values()].some((form) => form.dirty));

  // Panes never close from here, so `cancel` has nothing to guard.
  const actions: DialogActions = {
    cancel: () => {},
    markSaved: (id) => {
      forms.current.set(id, { dirty: false, busy: false });
      sync();
    },
    report: (id, state) => {
      if (state) forms.current.set(id, state);
      else forms.current.delete(id);
      sync();
    },
  };

  // Sanctioned useEffect: registering a window listener is an external-system
  // subscription, not derivable during render.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      // A confirmed hard navigation (an organization switch) already asked.
      if (!isUnloadWarningSuppressed()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Runs `leave` now when nothing is unsaved, otherwise after confirmation. Ignored while a save runs. */
  const requestLeave = (leave: () => void, options?: LeaveOptions) => {
    // A save in flight cannot be discarded; mirror FormDialog and wait for it.
    if ([...forms.current.values()].some((form) => form.busy)) return;
    if (dirty) {
      setPendingLeave({ leave, description: options?.description ?? DISCARD_DESCRIPTION });
    } else leave();
  };

  // Sanctioned useEffect: registering with the app-wide guard is an external
  // store subscription. It re-registers each commit so the entry never holds a
  // stale `dirty`.
  useEffect(() => registerLeaveGuard(requestLeave));

  const dialog = (
    <DiscardChangesDialog
      isOpen={pendingLeave !== null}
      onClose={() => setPendingLeave(null)}
      onDiscard={() => {
        const pending = pendingLeave;
        setPendingLeave(null);
        pending?.leave();
      }}
      description={pendingLeave?.description ?? DISCARD_DESCRIPTION}
    />
  );

  return { actions, requestLeave, dialog };
}
