/**
 * Watch the dirty flag a form reports to its dialog or sheet. `FormActions`
 * with `control` reports `{ dirty, busy }` to `FormDialogContext`, the same
 * signal the unsaved-changes guard reads before Cancel asks "Discard unsaved
 * changes?".
 */
import type { ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { expect, vi } from "vitest";
import { FormDialogContext, type DialogFormState } from "@/components/ui/form-dialog-context";

/** Renders `ui` under a dialog context; `states` collects every reported dirty flag, in order. */
export function renderReportingDirty(ui: ReactNode, options?: Pick<RenderOptions, "wrapper">) {
  const states: boolean[] = [];
  const actions = {
    report: (_id: object, state: DialogFormState | null) => { if (state) states.push(state.dirty); },
    cancel: vi.fn(),
    markSaved: vi.fn(),
  };
  const view = render(<FormDialogContext.Provider value={actions}>{ui}</FormDialogContext.Provider>, options);
  return { states, ...view };
}

/** The form reported to the dialog, and never as dirty. */
export function expectStayedClean(states: readonly boolean[]) {
  expect(states.length, "the form never reported its dirty state").toBeGreaterThan(0);
  expect(states.every((dirty) => !dirty), `reported ${JSON.stringify(states)}`).toBe(true);
}
