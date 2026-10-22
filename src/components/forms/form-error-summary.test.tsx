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
import { ItemText, listFieldErrors, orderFieldErrors } from "./form-error-summary";
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

const ANNOUNCEMENT = "Not saved. Fix the fields that show an error.";

function announcementOf() {
  return screen.getAllByRole("alert").find((node) => node.textContent === ANNOUNCEMENT);
}

async function pressSave() {
  fireEvent.click(screen.getByRole("button", { name: "Save sample" }));
  return screen.findByText("Not saved. Fix 3 fields.");
}

describe("FormErrorSummary", () => {
  it("shows nothing before the first save", () => {
    render(<SampleLikeForm onValid={vi.fn()} />);

    expect(screen.queryByText(/^Not saved\. Fix \d/)).toBeNull();
  });

  it("lists the refused fields in form order with their labels", async () => {
    render(<SampleLikeForm onValid={vi.fn()} />);

    const title = await pressSave();
    const summary = title.closest("[data-form-error-summary]") as HTMLElement;
    const links = within(summary).getAllByRole("link");

    // The list is not a live region; one fixed line announces each refusal.
    expect(summary.getAttribute("role")).toBeNull();
    expect(announcementOf()).toBeTruthy();
    expect(links.map((link) => link.textContent)).toEqual([
      // Names only: the reason shows once, at the field.
      "Credit batch",
      "Lab name",
      "pH",
    ]);
  });

  it("reads the labels on any submit, not only a Save click", async () => {
    render(<SampleLikeForm onValid={vi.fn()} />);

    fireEvent.submit(screen.getByRole("form", { name: "Sample" }));

    expect(await screen.findByRole("link", { name: "Credit batch" })).toBeTruthy();
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

    fireEvent.click(screen.getByRole("link", { name: "pH" }));

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
    await waitFor(() => expect(screen.queryByText(/^Not saved\. Fix \d/)).toBeNull());
    expect(onValid).not.toHaveBeenCalled();
  });
});

describe("FormErrorSummary announcement", () => {
  it("keeps one announcement per refused save while the list empties and refills", async () => {
    render(<SampleLikeForm onValid={vi.fn()} />);
    await pressSave();
    const first = announcementOf();

    fireEvent.change(screen.getByLabelText(/^pH/), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText(/^Lab name/), { target: { value: "SGS" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Credit batch/ }));
    });
    await waitFor(() => expect(screen.queryByText(/^Not saved\. Fix \d/)).toBeNull());
    fireEvent.change(screen.getByLabelText(/^pH/), { target: { value: "20" } });
    await screen.findByText("Not saved. Fix 1 field.");

    // Same node: React did not remount the alert, so it is not read again.
    expect(announcementOf()).toBe(first);
  });
});

describe("FormErrorSummary rows", () => {
  const rowsSchema = z.object({
    ingredients: z.array(z.object({ sharePercent: z.coerce.number().max(100, "Enter at most 100.") })),
  });

  function RowsForm() {
    const { control, register, handleSubmit } = useForm<z.input<typeof rowsSchema>, unknown, z.output<typeof rowsSchema>>({
      resolver: zodResolver(rowsSchema),
      defaultValues: { ingredients: [{ sharePercent: "10" }, { sharePercent: "120" }] },
    });
    return (
      <form aria-label="Blend" onSubmit={handleSubmit(vi.fn())}>
        {[0, 1].map((index) => (
          <FormField key={index} id={`share-${index}`} label="Share">
            <FormInput id={`share-${index}`} {...register(`ingredients.${index}.sharePercent`)} />
          </FormField>
        ))}
        <FormActions control={control} submitLabel="Save blend" />
      </form>
    );
  }

  it("names the row of a field array entry", async () => {
    render(<RowsForm />);

    fireEvent.click(screen.getByRole("button", { name: "Save blend" }));

    expect(await screen.findByRole("link", { name: "Share, row 2" })).toBeTruthy();
  });

  it("names the field and its row, never the message", async () => {
    document.body.innerHTML = "";
    const errors = { ingredients: [undefined, { materialId: { type: "custom", message: "Blend material is required" } }] };
    const items = orderFieldErrors(listFieldErrors({ errors } as never), new Map([["ingredients.1.materialId", { label: "Blend material", index: 0 }]]));
    const { container } = render(<ul>{items.map((item) => <li key={item.path}><ItemText item={item} /></li>)}</ul>);

    expect(container.textContent).toBe("Blend material, row 2");
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

  it("finds a picker by data-field-name when its id is not the field name", () => {
    document.body.innerHTML = `
      <form>
        <label for="incident-reactorId">Reactor</label>
        <button type="button" role="combobox" id="incident-reactorId" data-field-name="reactorId">Choose</button>
      </form>`;

    expect(readFieldDirectory(document.querySelector("form")).get("reactorId")).toEqual({ label: "Reactor", index: 0 });
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

describe("FormActions error box", () => {
  function BoxForm({ message, action }: { message?: string; action?: string }) {
    const { control, register, handleSubmit } = useForm<{ labName: string }>({ defaultValues: { labName: "x" } });
    return (
      <form aria-label="Box" onSubmit={handleSubmit(vi.fn())}>
        <FormField id="labName" label="Lab name">
          <FormInput id="labName" {...register("labName")} />
        </FormField>
        <FormActions
          control={control}
          submitLabel="Save box"
          errorMessage={message}
          errorAction={action ? <span>{action}</span> : undefined}
        />
      </form>
    );
  }

  it("shows a server message as title and detail, with references last", () => {
    render(<BoxForm message="Held by application AP-26-001. To change this, first correct or remove that application." action="Drawing on this bin: PR-014" />);

    const box = screen.getByText("Held by application AP-26-001.").closest("[role='alert']") as HTMLElement;
    expect(within(box).getByText("To change this, first correct or remove that application.")).toBeTruthy();
    expect(box.textContent?.endsWith("Drawing on this bin: PR-014")).toBe(true);
  });

  it("sits before the sticky footer, not inside it", () => {
    render(<BoxForm message="Action failed." />);

    const box = screen.getByText("Action failed.").closest("[role='alert']") as HTMLElement;
    const footer = screen.getByRole("button", { name: "Save box" }).closest(".sticky") as HTMLElement;
    expect(footer.contains(box)).toBe(false);
    expect(box.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves focus to a message-only box after a refused save, once per attempt", async () => {
    render(<BoxForm message="This record is sent to a Removal. Correct the Removal first." />);
    const wrapper = screen.getByText("This record is sent to a Removal.").closest("[tabindex='-1']") as HTMLElement;
    expect(document.activeElement).not.toBe(wrapper);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save box" }));
    });

    await waitFor(() => expect(document.activeElement).toBe(wrapper));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("folds the message into the count box as its detail when fields are listed", async () => {
    function Both() {
      const { control, register, handleSubmit } = useForm<{ labName: string }>({ defaultValues: { labName: "" } });
      return (
        <form aria-label="Both" onSubmit={handleSubmit(() => {})}>
          <FormField id="labName" label="Lab name">
            <FormInput id="labName" {...register("labName", { required: "Lab name is required" })} />
          </FormField>
          <FormActions control={control} submitLabel="Save both" errorMessage="Locked by a Removal." />
        </form>
      );
    }
    render(<Both />);
    fireEvent.click(screen.getByRole("button", { name: "Save both" }));

    const title = await screen.findByText("Not saved. Fix 1 field.");
    const box = title.closest("[data-form-error-summary]") as HTMLElement;
    expect(within(box).getByText("Locked by a Removal.")).toBeTruthy();
    expect(screen.getAllByRole("alert").filter((node) => node.textContent?.includes("Locked by a Removal."))).toHaveLength(0);
  });

  it("does not steal focus when a lock's field is put back and only the message is left", async () => {
    function Locked() {
      const { control, register, handleSubmit, setError, clearErrors } = useForm<{ labName: string }>({ defaultValues: { labName: "x" } });
      return (
        <form aria-label="Locked" onSubmit={handleSubmit(() => setError("labName", { type: "locked", message: "Locked" }))}>
          <FormField id="labName" label="Lab name">
            <FormInput id="labName" {...register("labName")} />
          </FormField>
          <button type="button" onClick={() => clearErrors("labName")}>Revalidate</button>
          <FormActions control={control} submitLabel="Save locked" errorMessage="Locked by a Removal." />
        </form>
      );
    }
    render(<Locked />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save locked" }));
    });
    await waitFor(() => expect(document.activeElement?.id).toBe("labName"));
    expect(screen.getAllByRole("alert").some(node => node.textContent === "Not saved. 1 field is locked.")).toBe(true);
    expect(screen.queryByText(/Undo that change to save/)).toBeNull();
    const scrolls = vi.mocked(Element.prototype.scrollIntoView).mock.calls.filter(([arg]) => (arg as ScrollIntoViewOptions)?.block === "nearest").length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revalidate" }));
    });

    expect(document.activeElement?.id).toBe("labName");
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.filter(([arg]) => (arg as ScrollIntoViewOptions)?.block === "nearest").length).toBe(scrolls);
  });
});

describe("FormActions error box without control", () => {
  function Plain({ message }: { message?: string }) {
    return (
      <form aria-label="Plain">
        <FormActions submitLabel="Save plain" errorMessage={message} />
      </form>
    );
  }

  it("scrolls a new message into view without moving focus", () => {
    const { rerender } = render(<Plain />);
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    const before = document.activeElement;

    rerender(<Plain message="Template was not saved. Try again." />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(document.activeElement).toBe(before);

    rerender(<Plain message="Template was not saved. Try again." />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<Plain message="Something else failed." />);
    expect(scroll).toHaveBeenCalledTimes(2);
  });
});
