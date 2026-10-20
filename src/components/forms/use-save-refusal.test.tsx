// @vitest-environment jsdom
/**
 * A refused save shows at the field it names, is listed in the error summary
 * and takes focus, like a client-side error. Locks word the summary apart.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { FormActions } from "./form-actions";
import { FormField } from "./form-field";
import { FormInput } from "./form-input";
import { useSaveRefusal } from "./use-save-refusal";

type Values = { labName: string; massKg: string; notes: string };
const FORM_ID = "sample-form";
const LOCK_REASON = "This record is sent to a Removal. Correct the Removal first.";

const issue = (path: string[], message: string, code = "validation_failed") => ({ path, code, message });

function Harness({ refusal }: { refusal: ActionError }) {
  const [footer, setFooter] = useState<string | undefined>();
  const { control, register, handleSubmit, setError, formState: { errors } } = useForm<Values>({
    defaultValues: { labName: "", massKg: "5", notes: "" },
  });
  const refuse = useSaveRefusal({ control, setError, formId: FORM_ID, aliases: { weight: "massKg" } });
  const save = handleSubmit(async () => {
    try {
      throw refusal;
    } catch (error) {
      const shown = refuse(error);
      setFooter(shown ? shown.footer ?? undefined : (error as Error).message);
    }
  });
  return (
    <>
      <form id={FORM_ID} aria-label="Sample" onSubmit={save}>
        <FormField id="labName" label="Lab name" error={errors.labName?.message}>
          <FormInput id="labName" {...register("labName")} />
        </FormField>
        <FormField id="massKg" label="Wet mass" error={errors.massKg?.message}>
          <FormInput id="massKg" {...register("massKg")} />
        </FormField>
      </form>
      <FormActions control={control} formId={FORM_ID} submitLabel="Save sample" errorMessage={footer} />
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function save() {
  return act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save sample" }));
  });
}

describe("useSaveRefusal", () => {
  it("shows a server issue at its field, lists it in the summary and focuses the field", async () => {
    render(<Harness refusal={new ActionError({ error: "Refused", issues: [issue(["labName"], "Lab was not found.")] })} />);
    await save();
    expect(await screen.findByText("Not saved. Fix 1 field.")).toBeTruthy();
    expect(screen.getAllByText(/Lab was not found\./).length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Lab name")));
  });

  it("splits a refusal: the field shown at its field, the rest in the footer", async () => {
    render(<Harness refusal={new ActionError({ error: "Refused", issues: [issue(["labName"], "Lab was not found."), issue(["driverId"], "Driver was not found.")] })} />);
    await save();
    expect(await screen.findByText("Not saved. Fix 1 field.")).toBeTruthy();
    expect(screen.getAllByText("Driver was not found.")).toHaveLength(1);
  });

  it("words a lock apart: Locked at the changed field, the reason once", async () => {
    const refusal = new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [issue(["weight"], LOCK_REASON, "certification_locked")] });
    render(<Harness refusal={refusal} />);
    fireEvent.change(screen.getByLabelText("Wet mass"), { target: { value: "9" } });
    await save();
    expect(await screen.findByText("Not saved. 1 field is locked.")).toBeTruthy();
    expect(screen.getAllByText("Locked").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(LOCK_REASON)).toHaveLength(1);
  });

  it("puts a lock on a field the operator did not change in the footer only", async () => {
    const refusal = new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [issue(["weight"], LOCK_REASON, "certification_locked")] });
    render(<Harness refusal={refusal} />);
    await save();
    expect(await screen.findByText(LOCK_REASON)).toBeTruthy();
    expect(screen.queryByText("Locked")).toBeNull();
    expect(screen.queryByText(/Not saved\./)).toBeNull();
  });

  it("leaves other errors to the caller", async () => {
    render(<Harness refusal={new ActionError({ error: "Boom", issues: [] })} />);
    await save();
    expect(await screen.findByText("Boom")).toBeTruthy();
  });
});
