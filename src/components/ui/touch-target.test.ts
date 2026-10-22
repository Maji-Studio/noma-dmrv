import { describe, expect, it } from "vitest";
import {
  CENTRED_HIT_AREA,
  ICON_BUTTON_HIT_AREA,
  INLINE_HIT_AREA,
  INLINE_HIT_AREA_FROM_SM,
} from "./touch-target";

const classes = (recipe: string) => recipe.split(" ");

describe("touch target recipes", () => {
  it("centres a 44px square-or-wider hit area on the control with a ::before", () => {
    expect(classes(CENTRED_HIT_AREA)).toEqual(
      expect.arrayContaining(["relative", "before:h-44", "before:w-full", "before:min-w-44", "before:-translate-x-1/2", "before:-translate-y-1/2"]),
    );
    expect(CENTRED_HIT_AREA).not.toContain("after:");
  });

  it("gives an inline link a 44px tall ::after across its width", () => {
    expect(classes(INLINE_HIT_AREA)).toEqual(expect.arrayContaining(["relative", "after:h-44", "after:inset-x-0", "after:-translate-y-1/2"]));
    expect(INLINE_HIT_AREA).not.toContain("before:");
    expect(INLINE_HIT_AREA_FROM_SM.split(" ").every((c) => c.startsWith("sm:"))).toBe(true);
  });

  it("restores the 32px icon button width alongside the hit area", () => {
    expect(classes(ICON_BUTTON_HIT_AREA)).toEqual(expect.arrayContaining(["w-32", "shrink-0", "before:h-44"]));
  });
});
