import { describe, expect, it, vi } from "vitest";
import {
  applyFieldPositionMode,
  resetFieldPosition,
} from "./field-position-field";

describe("applyFieldPositionMode", () => {
  it("hands manual coordinates back to the undirty delivery prefill", () => {
    const setMode = vi.fn();
    const resetToDerived = vi.fn();

    applyFieldPositionMode("manual", setMode, resetToDerived);
    expect(resetToDerived).not.toHaveBeenCalled();

    applyFieldPositionMode("derive", setMode, resetToDerived);
    expect(setMode).toHaveBeenLastCalledWith("derive");
    expect(resetToDerived).toHaveBeenCalledOnce();
  });

  it("resets both coordinate fields to the delivery position as undirty", () => {
    const fields = {
      gpsLatitude: { value: 1, isDirty: true },
      gpsLongitude: { value: 2, isDirty: true },
    };
    const resetField = vi.fn(
      (
        name: keyof typeof fields,
        options: { defaultValue: number | null },
      ) => {
        fields[name] = {
          value: options.defaultValue ?? 0,
          isDirty: false,
        };
      },
    );

    resetFieldPosition(resetField, {
      gpsLatitude: -6.8,
      gpsLongitude: 39.28,
    });

    expect(fields).toEqual({
      gpsLatitude: { value: -6.8, isDirty: false },
      gpsLongitude: { value: 39.28, isDirty: false },
    });
    expect(resetField).toHaveBeenCalledTimes(2);
  });
});
