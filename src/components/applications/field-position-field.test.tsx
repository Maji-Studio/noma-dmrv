import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FieldPositionField,
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

describe("From customer position", () => {
  const render = (props: { required?: boolean; latitudeError?: string }) =>
    renderToStaticMarkup(
      <FieldPositionField derived={null} hasDelivery latitude={null} longitude={null}
        mode="derive" onModeChange={vi.fn()} onPositionChange={vi.fn()} onDerive={vi.fn()} {...props} />,
    );

  it("marks the customer location required and shows the save error under it", () => {
    const markup = render({ required: true, latitudeError: "Customer location coordinates are required." });
    expect(markup).toContain("sr-only\">Required");
    expect(markup).toContain("Customer location coordinates are required.");
  });

  it("shows neither while another evidence method is chosen", () => {
    expect(render({})).not.toContain("Required");
  });
});
