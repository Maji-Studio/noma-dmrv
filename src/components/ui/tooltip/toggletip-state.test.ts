import { describe, expect, it } from "vitest";
import {
  applyTooltipOpenChange,
  pressToggletip,
  TOGGLETIP_CLOSED,
  type ToggletipState,
} from "./toggletip-state";

const PINNED: ToggletipState = { open: true, pinned: true };
const HOVER_OPEN: ToggletipState = { open: true, pinned: false };

describe("InfoHint toggletip state", () => {
  it("opens on a tap and closes on the next tap", () => {
    const opened = pressToggletip(TOGGLETIP_CLOSED);
    expect(opened).toEqual(PINNED);
    expect(pressToggletip(opened)).toEqual(TOGGLETIP_CLOSED);
  });

  it("ignores Base UI's own trigger-press close, so a tap never opens and closes at once", () => {
    expect(applyTooltipOpenChange(PINNED, false, "trigger-press")).toEqual(PINNED);
    expect(applyTooltipOpenChange(TOGGLETIP_CLOSED, true, "trigger-press")).toEqual(TOGGLETIP_CLOSED);
  });

  it("pins a tip opened by hover or keyboard focus when it is pressed", () => {
    expect(pressToggletip(HOVER_OPEN)).toEqual(PINNED);
  });

  it("opens on hover and keyboard focus without pinning", () => {
    expect(applyTooltipOpenChange(TOGGLETIP_CLOSED, true, "trigger-hover")).toEqual(HOVER_OPEN);
    expect(applyTooltipOpenChange(TOGGLETIP_CLOSED, true, "trigger-focus")).toEqual(HOVER_OPEN);
  });

  it("keeps a pinned tip open when the pointer leaves, and closes an unpinned one", () => {
    expect(applyTooltipOpenChange(PINNED, false, "trigger-hover")).toEqual(PINNED);
    expect(applyTooltipOpenChange(HOVER_OPEN, false, "trigger-hover")).toEqual(TOGGLETIP_CLOSED);
  });

  it("closes on Escape, an outside press and blur, pinned or not", () => {
    for (const reason of ["escape-key", "outside-press", "trigger-focus"]) {
      expect(applyTooltipOpenChange(PINNED, false, reason)).toEqual(TOGGLETIP_CLOSED);
      expect(applyTooltipOpenChange(HOVER_OPEN, false, reason)).toEqual(TOGGLETIP_CLOSED);
    }
  });
});
