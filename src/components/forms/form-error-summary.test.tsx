// @vitest-environment jsdom
/**
 * A refused save lists the fields to fix above Save, in form order with their
 * labels, moves focus to the first one, links each entry to its field and
 * drops an entry once its field is fixed.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Controller, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FormActions } from "./form-actions";
import { FormField } from "./form-field";
import { FormInput } from "./form-input";
import { listFieldErrors, orderFieldErrors } from "./form-error-summary";
import { readFieldDirectory } from "./form-error-summary-dom";

const schema = z.object({
  batchId: z.string().min(1, "Select a credit batch."),
  labName: z.string().min(1, "Lab name is required"),
  ph: z.coerce.number().min(0, "Must be between 0 and 14").max(14, "Must be between 0 and 14"),
});

type Values = z.input<typeof schema>;

function SampleLikeForm({ onValid }: { onValid: () => void }) {
  const { control, register, handleSubmit, formState: { errors } } = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { batchId: "", labName: "", ph: "20" },
  });
  return (
    <form aria-label="Sample" onSubmit={handleSubmit(onValid)}>
      {/* A picker RHF cannot focus: its ref is not attached, as with the entity select. */}
      <FormField id="batchId" label="Credit batch" required error={errors.batchId?.message}>
        <Controller
          control={control}
          name="batchId"
          render={({ field }) => (
            <button id="batchId" type="button" onClick={() => field.onChange("CB-1")}>
              {field.value || "Choose"}
            </button>
          )}
        />
      </FormField>
      <FormField id="labName" label="Lab name" required error={errors.labName?.message}>
        <FormInput id="labName" {...register("labName")} />
      </FormField>
      <FormField id="ph" label="pH" error={errors.ph?.message}>
        <FormInput id="ph" type="number" {...register("ph")} />
      </FormField>
      <FormActions control={control} submitLabel="Save sample" />
    </form>
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

async function pressSave() {
  fireEvent.click(screen.getByRole("button", { name: "Save sample" }));
  return screen.findByText("Not saved. Fix 3 fields.");
}

describe("FormErrorSummary", () => {
  it("shows nothing before the first save", () => {
    render(<SampleLikeForm onValid={vi.fn()} />);

    expect(screen.queryByText(/Not saved/)).toBeNull();
  });

  it("lists the refused fields in form order with their labels", async () => {
    render(<SampleLikeForm onValid={vi.fn()} />);

    const title = await pressSave();
    const summary = title.closest("[data-form-error-summary]") as HTMLElement;
    const links = within(summary).getAllByRole("link");

    expect(summary.getAttribute("role")).toBe("alert");
    expect(links.map((link) => link.textContent)).toEqual([
      "Credit batch: Select a credit batch.",
      // The message already names its field, so no "Lab name:" lead.
      "Lab name is required",
      "pH: Must be between 0 and 14",
    ]);
  });

  it("moves focus to the first field in the form, not the first one RHF registered", async () => {
    render(<SampleLikeForm onValid={vi.fn()} />);

    await pressSave();

    await waitFor(() => expect(document.activeElement?.id).toBe("batchId"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("focuses a field from its link", async () => {
    render(<SampleLikeForm onValid={vi.fn()} />);
    await pressSave();
    await waitFor(() => expect(document.activeElement?.id).toBe("batchId"));

    fireEvent.click(screen.getByRole("link", { name: "pH: Must be between 0 and 14" }));

    expect(document.activeElement?.id).toBe("ph");
  });

  it("drops a fixed field and goes once every field is fixed", async () => {
    const onValid = vi.fn();
    render(<SampleLikeForm onValid={onValid} />);
    await pressSave();

    fireEvent.change(screen.getByLabelText(/^pH/), { target: { value: "7" } });
    await screen.findByText("Not saved. Fix 2 fields.");
    expect(screen.queryByRole("link", { name: /^pH/ })).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Lab name/), { target: { value: "SGS" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Credit batch/ }));
    });
    await waitFor(() => expect(screen.queryByText(/Not saved/)).toBeNull());
    expect(onValid).not.toHaveBeenCalled();
  });
});

describe("listFieldErrors", () => {
  it("flattens nested and array errors and skips the form-level root", () => {
    const errors = {
      root: { serverError: { type: "server", message: "Not saved." } },
      ingredients: [undefined, { sharePercent: { type: "too_big", message: "Enter at most 100." } }],
      gps: { root: { type: "custom", message: "Enter both coordinates." } },
      blank: { type: "custom", message: "" },
      "": { type: "invalid_type", message: "Invalid input: expected date, received string" },
    };

    expect(listFieldErrors({ errors } as never)).toEqual([
      { path: "ingredients.1.sharePercent", message: "Enter at most 100." },
      { path: "gps.root", message: "Enter both coordinates." },
    ]);
  });
});

describe("orderFieldErrors", () => {
  it("places a group error at its first control without borrowing that control's label", () => {
    document.body.innerHTML = `
      <form>
        <label for="name">Name</label><input id="name" name="name" />
        <fieldset><legend>Ingredients</legend>
          <label for="share">Share <span class="sr-only">(%)</span><span aria-hidden="true">*</span><span class="sr-only">Required</span></label>
          <input id="share" name="ingredients.0.sharePercent" />
        </fieldset>
      </form>`;
    const directory = readFieldDirectory(document.querySelector("form"));

    expect(
      orderFieldErrors(
        [
          { path: "unknown", message: "Check this." },
          { path: "ingredients.root", message: "Shares add up to more than 100%." },
          { path: "ingredients.0.sharePercent", message: "Enter at most 100." },
          { path: "name", message: "Enter a name." },
        ],
        directory,
      ),
    ).toEqual([
      { path: "name", message: "Enter a name.", label: "Name", located: true },
      { path: "ingredients.root", message: "Shares add up to more than 100%.", label: null, located: true },
      { path: "ingredients.0.sharePercent", message: "Enter at most 100.", label: "Share", located: true },
      { path: "unknown", message: "Check this.", label: null, located: false },
    ]);
  });

  it("names a radio group by its legend", () => {
    document.body.innerHTML = `
      <form>
        <fieldset><legend>Status</legend>
          <label><input type="radio" name="status" value="a" />Planned</label>
          <label><input type="radio" name="status" value="b" />Complete</label>
        </fieldset>
      </form>`;

    expect(readFieldDirectory(document.querySelector("form")).get("status")?.label).toBe("Status");
  });
});
