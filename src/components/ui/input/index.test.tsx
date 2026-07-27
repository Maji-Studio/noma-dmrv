import type { KeyboardEvent, WheelEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  preventNumberInputKeyChange,
  preventNumberInputWheelChange,
} from "./index";

describe("preventNumberInputWheelChange", () => {
  it("removes focus so scrolling cannot change the numeric value", () => {
    const blur = vi.fn();
    const event = {
      currentTarget: { blur },
    } as unknown as WheelEvent<HTMLInputElement>;

    preventNumberInputWheelChange(event);

    expect(blur).toHaveBeenCalledOnce();
  });
});

describe("preventNumberInputKeyChange", () => {
  it.each(["ArrowUp", "ArrowDown"])(
    "prevents %s from stepping the numeric value",
    (key) => {
      const preventDefault = vi.fn();
      const event = {
        key,
        preventDefault,
      } as unknown as KeyboardEvent<HTMLInputElement>;

      preventNumberInputKeyChange(event);

      expect(preventDefault).toHaveBeenCalledOnce();
    },
  );

  it.each(["1", ".", "Tab", "ArrowLeft", "ArrowRight"])(
    "preserves normal number entry for %s",
    (key) => {
      const preventDefault = vi.fn();
      const event = {
        key,
        preventDefault,
      } as unknown as KeyboardEvent<HTMLInputElement>;

      preventNumberInputKeyChange(event);

      expect(preventDefault).not.toHaveBeenCalled();
    },
  );
});
