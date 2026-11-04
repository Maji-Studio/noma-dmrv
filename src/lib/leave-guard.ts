/**
 * The app-wide seam between a pane that holds unsaved edits and chrome outside
 * it (the sidebar organization switcher) that is about to leave the page.
 *
 * `useUnsavedPaneGuard` registers its `requestLeave` while a pane is mounted.
 * Anything that is about to move the operator away asks `requestAppLeave`
 * first: with nothing registered it simply runs, otherwise the pane asks with
 * the shared discard dialog and runs it only on Discard.
 *
 * `suppressUnloadWarning` is for the last step of a leave the operator already
 * confirmed, a hard `window.location` load: the pane's `beforeunload` prompt
 * would otherwise ask a second time, and answering Stay would strand the page
 * in the old context.
 */
export type LeaveOptions = {
  /** The discard dialog's body text, naming what the leave does. */
  description?: string;
};

export type RequestLeave = (leave: () => void, options?: LeaveOptions) => void;

let registered: RequestLeave | null = null;
let unloadWarningSuppressed = false;

// A page restored from the back-forward cache keeps this module state, so the
// suppression of a switch that has since been left would outlive it.
if (typeof window !== "undefined") {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) unloadWarningSuppressed = false;
  });
}

/** Registers the mounted pane's guard; the returned function removes it. */
export function registerLeaveGuard(requestLeave: RequestLeave): () => void {
  registered = requestLeave;
  return () => {
    if (registered === requestLeave) registered = null;
  };
}

/** Runs `leave` now, or after the mounted pane's discard confirmation. */
export const requestAppLeave: RequestLeave = (leave, options) => {
  if (registered) registered(leave, options);
  else leave();
};

/** Call right before a hard navigation the operator confirmed. */
export function suppressUnloadWarning(): void {
  unloadWarningSuppressed = true;
}

export function isUnloadWarningSuppressed(): boolean {
  return unloadWarningSuppressed;
}
