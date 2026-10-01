/**
 * Open state of the InfoHint toggletip.
 *
 * Base UI's Tooltip opens on hover and on keyboard-visible focus, and closes on
 * Escape, an outside press, blur and pointer leave. A toggletip also has to
 * open on a tap, where there is no hover. A press "pins" the tip: it stays
 * open when the pointer leaves, and a second press closes it.
 *
 * Base UI also asks to close on a press of its own trigger (reason
 * "trigger-press"). The press handler owns presses, so that request is ignored;
 * otherwise a tap would open the tip and close it in the same gesture.
 */

export interface ToggletipState {
  open: boolean;
  /** Opened by a press. Survives pointer leave; the next press closes it. */
  pinned: boolean;
}

export const TOGGLETIP_CLOSED: ToggletipState = { open: false, pinned: false };

const TRIGGER_PRESS = "trigger-press";
const TRIGGER_HOVER = "trigger-hover";

/** A press on the trigger: tap, click, Enter or Space. */
export function pressToggletip(state: ToggletipState): ToggletipState {
  return state.open && state.pinned ? TOGGLETIP_CLOSED : { open: true, pinned: true };
}

/** Base UI's own open-change request, with its reason string. */
export function applyTooltipOpenChange(
  state: ToggletipState,
  next: boolean,
  reason: string,
): ToggletipState {
  if (reason === TRIGGER_PRESS) return state;
  if (next) return { open: true, pinned: state.pinned };
  if (state.pinned && reason === TRIGGER_HOVER) return state;
  return TOGGLETIP_CLOSED;
}
