// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ActionError } from "@/lib/action-error";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FieldPositionField,
  type FieldPositionMode,
  applyFieldPositionMode,
  resetFieldPosition,
} from "./field-position-field";

type PositionValues = { gpsLatitude: number | null; gpsLongitude: number | null };

const SAVED_POSITION = { gpsLatitude: -8.5, gpsLongitude: 35.2 };
const CUSTOMER_POSITION = { gpsLatitude: -6.8, gpsLongitude: 39.28 };
const EDITED_POSITION = { gpsLatitude: -9, gpsLongitude: 36 };
const FORM_ID = "field-position-refusal";
const LOCK_REASON = "Sent to a Removal.";

function PositionRefusalHarness() {
  const [mode, setMode] = useState<FieldPositionMode>("manual");
  const { register, setValue, resetField, setError, control, handleSubmit, formState: { isDirty } } = useForm<PositionValues>({ defaultValues: SAVED_POSITION });
  const refuse = useSaveRefusal({ control, resetField, setError, formId: FORM_ID });
  const derive = () => resetFieldPosition(setValue, CUSTOMER_POSITION);
  return (
    <form id={FORM_ID} onSubmit={handleSubmit(() => refuse(new ActionError({
      error: LOCK_REASON, code: "certification_locked",
      issues: ["gpsLatitude", "gpsLongitude"].map(name => ({
        path: [name], code: "certification_locked", message: LOCK_REASON,
      })),
    }), "Application was not saved."))}>
      <input aria-label="Latitude" {...register("gpsLatitude")} />
      <input aria-label="Longitude" {...register("gpsLongitude")} />
      <output data-testid="mode">{mode}</output>
      <output data-testid="dirty">{String(isDirty)}</output>
      <button type="button" onClick={() => applyFieldPositionMode("derive", setMode, derive)}>From customer</button>
      <button type="button" onClick={() => applyFieldPositionMode("manual", setMode, derive)}>Manual</button>
      <button type="button" onClick={() => {
        setValue("gpsLatitude", EDITED_POSITION.gpsLatitude, { shouldDirty: true });
        setValue("gpsLongitude", EDITED_POSITION.gpsLongitude, { shouldDirty: true });
      }}>Drop pin</button>
      <button type="submit">Save</button>
    </form>
  );
}

it("restores the saved pin after deriving, switching to manual, editing, and receiving a lock refusal", async () => {
  const view = render(<PositionRefusalHarness />);
  const latitude = () => (view.getByLabelText("Latitude") as HTMLInputElement).value;
  const longitude = () => (view.getByLabelText("Longitude") as HTMLInputElement).value;
  try {
    await act(async () => { fireEvent.click(view.getByText("From customer")); });
    expect(latitude()).toBe(String(CUSTOMER_POSITION.gpsLatitude));
    expect(longitude()).toBe(String(CUSTOMER_POSITION.gpsLongitude));
    expect(view.getByTestId("dirty").textContent).toBe("true");
    fireEvent.click(view.getByText("Manual"));
    expect(view.getByTestId("mode").textContent).toBe("manual");
    fireEvent.click(view.getByText("Drop pin"));
    expect(latitude()).toBe(String(EDITED_POSITION.gpsLatitude));
    expect(longitude()).toBe(String(EDITED_POSITION.gpsLongitude));
    await act(async () => { fireEvent.click(view.getByText("Save")); });
    await waitFor(() => expect(latitude()).toBe(String(SAVED_POSITION.gpsLatitude)));
    expect(longitude()).toBe(String(SAVED_POSITION.gpsLongitude));
    expect(view.getByTestId("dirty").textContent).toBe("false");
    await act(async () => { fireEvent.click(view.getByText("Save")); });
    await waitFor(() => expect(latitude()).toBe(String(SAVED_POSITION.gpsLatitude)));
    expect(longitude()).toBe(String(SAVED_POSITION.gpsLongitude));
  } finally { cleanup(); }
});

describe("applyFieldPositionMode", () => {
  it("hands manual coordinates back to the delivery prefill", () => {
    const setMode = vi.fn();
    const resetToDerived = vi.fn();

    applyFieldPositionMode("manual", setMode, resetToDerived);
    expect(resetToDerived).not.toHaveBeenCalled();

    applyFieldPositionMode("derive", setMode, resetToDerived);
    expect(setMode).toHaveBeenLastCalledWith("derive");
    expect(resetToDerived).toHaveBeenCalledOnce();
  });

  it.each([CUSTOMER_POSITION, null])("updates coordinates and dirty state without changing saved defaults: %j", async derived => {
    const { result, unmount } = renderHook(() => {
      const form = useForm<PositionValues>({ defaultValues: SAVED_POSITION });
      form.register("gpsLatitude");
      form.register("gpsLongitude");
      // Subscribe so RHF computes the state used by the unsaved-changes guard.
      const { isDirty, dirtyFields, defaultValues } = form.formState;
      return { form, isDirty, dirtyFields, defaultValues };
    });
    try {
      await act(async () => resetFieldPosition(result.current.form.setValue, derived));
      expect(result.current.form.getValues()).toEqual(derived ?? { gpsLatitude: null, gpsLongitude: null });
      expect(result.current.isDirty).toBe(true);
      expect(result.current.dirtyFields).toEqual({ gpsLatitude: true, gpsLongitude: true });
      expect(result.current.defaultValues).toEqual(SAVED_POSITION);
      await act(async () => resetFieldPosition(result.current.form.setValue, SAVED_POSITION));
      expect(result.current.isDirty).toBe(false);
    } finally { unmount(); }
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
