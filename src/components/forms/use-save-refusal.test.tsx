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

const FALLBACK = "Sample was not saved.";

function Harness({ refusal }: { refusal: unknown }) {
  const [footer, setFooter] = useState<string | null>(null);
  const { control, register, handleSubmit, setError, resetField, formState: { errors } } = useForm<Values>({
    defaultValues: { labName: "", massKg: "5", notes: "" },
  });
  const refuse = useSaveRefusal({ control, setError, resetField, formId: FORM_ID, aliases: { weight: "massKg" } });
  const save = handleSubmit(async () => {
    try {
      throw refusal;
    } catch (error) {
      setFooter(refuse(error, FALLBACK));
    }
  });
  return (
    <>
      <form id={FORM_ID} aria-label="Sample" onSubmit={save} data-lock-refusal={errors.root?.lockRefusal ? "yes" : "no"}>
        <FormField id="labName" label="Lab name" error={errors.labName?.message}>
          <FormInput id="labName" {...register("labName")} />
        </FormField>
        <FormField id="massKg" label="Wet mass" error={errors.massKg?.message}>
          <FormInput id="massKg" {...register("massKg")} />
        </FormField>
      </form>
      <FormActions control={control} formId={FORM_ID} submitLabel="Save sample" errorMessage={footer ?? undefined} />
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
    // The reason shows once, at the field; the summary names the field only.
    expect(screen.getAllByText(/Lab was not found\./)).toHaveLength(1);
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(screen.getByRole("link", { name: "Lab name" })).toBeTruthy();
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
    await screen.findAllByText("Not saved. 1 field is locked.");
    // Spoken once, from focus: the box takes focus, so the alert stays silent.
    expect(screen.queryAllByRole("alert").some((node) => node.textContent === "Not saved. 1 field is locked.")).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Not saved. 1 field is locked.");
    expect(screen.getAllByText("Locked. Your change was not saved.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(LOCK_REASON)).toHaveLength(1);
    expect((screen.getByLabelText("Wet mass") as HTMLInputElement).value).toBe("5");
  });

  it("marks only a lock refusal for the top refusal wording", async () => {
    const lock = new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [issue(["weight"], LOCK_REASON, "certification_locked")] });
    const { unmount } = render(<Harness refusal={lock} />);
    await save();
    await waitFor(() => expect(screen.getByRole("form", { name: "Sample" }).getAttribute("data-lock-refusal")).toBe("yes"));
    unmount();
    render(<Harness refusal={new ActionError({ error: "Refused", issues: [issue(["labName"], "Lab was not found.")] })} />);
    await save();
    await screen.findByText("Not saved. Fix 1 field.");
    expect(screen.getByRole("form", { name: "Sample" }).getAttribute("data-lock-refusal")).toBe("no");
  });

  it("puts a lock on a field the operator did not change in the footer only", async () => {
    const refusal = new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [issue(["weight"], LOCK_REASON, "certification_locked")] });
    render(<Harness refusal={refusal} />);
    await save();
    expect(await screen.findByText("This record is sent to a Removal.")).toBeTruthy();
    expect(screen.getByText("Correct the Removal first.")).toBeTruthy();
    expect(screen.queryByText("Locked. Your change was not saved.")).toBeNull();
    expect(screen.queryByText(/Not saved\./)).toBeNull();
  });

  it.each([
    ["a stale version", new ActionError({ error: "Changed", code: "stale_version", issues: [issue(["labName"], "Reload first.")] })],
    ["a non-ActionError", new Error("Unexpected failure")],
    ["an issue-less refusal", new ActionError({ error: "Boom", issues: [] })],
  ])("returns the caller's fallback for %s", async (_name, refusal) => {
    render(<Harness refusal={refusal} />);
    await save();
    expect(await screen.findByText(FALLBACK)).toBeTruthy();
    expect(screen.queryByText("Not saved. Fix 1 field.")).toBeNull();
  });
});
