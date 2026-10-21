// @vitest-environment jsdom
/**
 * The over-draw of a feedstock bin arrives on `massWetKg`. It lands on the
 * total, or on the bin row once the operator hand-edited that row, and the
 * blockers show in the same box as the field link even though the footer has
 * no message of its own.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { FormActions } from "@/components/forms/form-actions";
import { FormField } from "@/components/forms/form-field";
import { FormInput } from "@/components/forms/form-input";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { FEEDSTOCK_UPDATE_REFUSAL_ALIASES, feedstockRefusalAliases } from "./feedstock-update-payload";

const FORM_ID = "feedstock-form";
const OVERDRAW = "This delivery would leave the bin short.";

type Values = { totalWetMassKg: string; allocations: Array<{ allocatedWetMassKg: string }> };

function Harness({ edited }: { edited: boolean }) {
  const [blockers, setBlockers] = useState<string | null>(null);
  const { control, register, handleSubmit, setError, formState: { errors } } = useForm<Values>({
    defaultValues: { totalWetMassKg: "400", allocations: [{ allocatedWetMassKg: "400" }] },
  });
  const refuse = useSaveRefusal({ control, setError, formId: FORM_ID, aliases: feedstockRefusalAliases(edited) });
  const submit = handleSubmit(() => {
    setBlockers(null);
    const refusal = new ActionError({
      error: OVERDRAW,
      code: "validation_failed",
      issues: [{ path: ["massWetKg"], code: "validation_failed", message: OVERDRAW }],
    });
    refuse(refusal);
    setBlockers("Drawing on this bin: PR-014, BP-003");
  });
  return (
    <>
      <form id={FORM_ID} aria-label="Feedstock" onSubmit={submit}>
        <FormField id="totalWetMassKg" label="Wet mass" error={errors.totalWetMassKg?.message}>
          <FormInput id="totalWetMassKg" {...register("totalWetMassKg")} />
        </FormField>
        <FormField id="allocations.0.allocatedWetMassKg" label="Bin mass" error={errors.allocations?.[0]?.allocatedWetMassKg?.message}>
          <FormInput id="allocations.0.allocatedWetMassKg" {...register("allocations.0.allocatedWetMassKg")} />
        </FormField>
      </form>
      <FormActions
        control={control}
        formId={FORM_ID}
        submitLabel="Save feedstock"
        errorAction={blockers ? <span>{blockers}</span> : undefined}
      />
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

describe("feedstockRefusalAliases", () => {
  it("keeps the static map until the bin row is edited by hand", () => {
    expect(feedstockRefusalAliases(false)).toBe(FEEDSTOCK_UPDATE_REFUSAL_ALIASES);
    expect(feedstockRefusalAliases(true)).toEqual({
      ...FEEDSTOCK_UPDATE_REFUSAL_ALIASES,
      massWetKg: "allocations.0.allocatedWetMassKg",
    });
  });
});

describe("feedstock over-draw", () => {
  it("shows the inline wet mass error and the blockers together", async () => {
    render(<Harness edited={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save feedstock" }));
    });
    const title = await screen.findByText("Not saved. Fix 1 field.");
    const box = title.closest("[data-form-error-summary]") as HTMLElement;
    // Names only in the box; the reason shows once, at the field.
    expect(within(box).getByRole("link").textContent).toBe("Wet mass");
    expect(screen.getAllByText(OVERDRAW)).toHaveLength(1);
    expect(document.getElementById("totalWetMassKg-error")?.textContent).toBe(OVERDRAW);
    expect(within(box).getByText("Drawing on this bin: PR-014, BP-003")).toBeTruthy();
  });

  it("files the over-draw on the bin row after a hand edit", async () => {
    render(<Harness edited />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save feedstock" }));
    });
    const title = await screen.findByText("Not saved. Fix 1 field.");
    const box = title.closest("[data-form-error-summary]") as HTMLElement;
    expect(within(box).getByRole("link").textContent).toBe("Bin mass, row 1");
  });
});
