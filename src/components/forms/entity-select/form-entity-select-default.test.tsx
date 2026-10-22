// @vitest-environment jsdom
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFieldArray, useForm, useFormState, type Control, type FieldValues, type UseFormReturn } from "react-hook-form";
import { FormEntitySelect } from "./form-entity-select";
import type { EntityOption } from "./types";

// #1360: the select's own pick of a lone option is the field's default, not an edit.
const state = vi.hoisted(() => ({ options: [] as EntityOption[] }));
vi.mock("@/hooks/use-refresh-entity-options-on-return", () => ({ useRefreshEntityOptionsOnReturn: () => () => {} }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: state.options, isLoading: false, error: null }),
  useEntityById: (_type: string, id: string | undefined) => ({ data: state.options.find((option) => option.id === id), isPending: false }),
}));
vi.mock("@/hooks/use-entity-edit-record", () => ({ isEditableEntityType: () => false, useCanManageFeedstockTypes: () => false }));

const NORTH: EntityOption = { id: "north", code: "N", name: "North bin" };
const SOUTH: EntityOption = { id: "south", code: "S", name: "South bin" };

beforeEach(() => {
  state.options = [NORTH];
  probe.dirty = true;
  probe.dirtyFields = {};
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

// Quick-add dialogs the select mounts (closed) read the query client.
const render = (ui: ReactElement) => renderView(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const trigger = () => screen.getAllByTestId("entity-select-trigger")[0];
const pick = (id: string) => { fireEvent.click(trigger()); fireEvent.click(screen.getByTestId(`entity-option-${id}`)); };

/** Exposes the live form so a test reads what the unsaved-changes guard reads. */
const probe = { dirty: true, dirtyFields: {} as object };
const record = (dirty: boolean, dirtyFields: object) => { probe.dirty = dirty; probe.dirtyFields = dirtyFields; };
function DirtyProbe<T extends FieldValues>({ control }: { control: Control<T> }) {
  const { isDirty, dirtyFields } = useFormState({ control });
  record(isDirty, dirtyFields);
  return null;
}

interface PickerValues { binId: string; note: string; customerId: string }

function Picker({ expose, dependsOn, onChange, defaults }: {
  expose: (form: UseFormReturn<PickerValues>) => void;
  dependsOn?: boolean;
  onChange?: (value: string | undefined, change: { asDefault: boolean }) => void;
  defaults?: Partial<PickerValues>;
}) {
  const form = useForm<PickerValues>({ defaultValues: { binId: "", note: "", customerId: "", ...defaults } });
  expose(form);
  const customerId = form.watch("customerId");
  return (
    <>
      <input aria-label="Note" {...form.register("note")} />
      <input aria-label="Customer" {...form.register("customerId")} />
      <FormEntitySelect
        control={form.control}
        name="binId"
        label="Storage bin"
        entityType="storageLocation"
        required
        onChange={onChange}
        dependsOn={dependsOn ? customerId : undefined}
      />
      <DirtyProbe control={form.control} />
    </>
  );
}

function renderPicker(props: Omit<Parameters<typeof Picker>[0], "expose"> = {}) {
  let form!: UseFormReturn<PickerValues>;
  render(<Picker {...props} expose={(value) => { form = value; }} />);
  return () => form;
}

describe("FormEntitySelect single-option auto-pick", () => {
  it("keeps an untouched form clean after picking the only option", async () => {
    const form = renderPicker();
    await waitFor(() => expect(form().getValues("binId")).toBe("north"));
    expect(probe.dirty).toBe(false);
    expect(probe.dirtyFields).toEqual({});
  });

  it("still dirties the form when the operator picks", async () => {
    state.options = [NORTH, SOUTH];
    renderPicker();
    pick("south");
    await waitFor(() => expect(probe.dirty).toBe(true));
    expect(probe.dirtyFields).toEqual({ binId: true });
  });

  it("dirties the form when the operator replaces the automatic pick", async () => {
    const form = renderPicker();
    await waitFor(() => expect(form().getValues("binId")).toBe("north"));
    state.options = [NORTH, SOUTH];
    pick("south");
    await waitFor(() => expect(probe.dirty).toBe(true));
  });

  it("keeps an automatic pick that follows an edit as an edit, so dirty-only patches still send it", async () => {
    state.options = [];
    const form = renderPicker();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "typed" } });
    await waitFor(() => expect(probe.dirty).toBe(true));
    state.options = [NORTH];
    // The form re-renders on a watched field, so the select sees its one option.
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "customer-one" } });
    await waitFor(() => expect(form().getValues("binId")).toBe("north"));
    expect(probe.dirtyFields).toMatchObject({ binId: true });
  });

  it("runs the caller's side effect on the automatic pick and says it set a default", async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("north", { asDefault: true }));
  });

  it("tells the caller's side effect that an operator pick is an edit", async () => {
    state.options = [NORTH, SOUTH];
    const onChange = vi.fn();
    renderPicker({ onChange });
    pick("south");
    expect(onChange).toHaveBeenLastCalledWith("south", { asDefault: false });
  });

  it("clears an automatic default after a dependency moves by default, then picks the new lone option as the default", async () => {
    const form = renderPicker({ dependsOn: true });
    await waitFor(() => expect(form().getValues("binId")).toBe("north"));
    state.options = [SOUTH];
    form().resetField("customerId", { defaultValue: "customer-two" });
    await waitFor(() => expect(form().getValues("binId")).toBe("south"));
    expect(probe.dirty).toBe(false);
  });

  it("clears as an edit when the operator moves the dependency, and the new pick stays an edit", async () => {
    const form = renderPicker({ dependsOn: true, defaults: { binId: "north", customerId: "customer-one" } });
    state.options = [SOUTH];
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "customer-two" } });
    await waitFor(() => expect(form().getValues("binId")).toBe("south"));
    expect(probe.dirtyFields).toMatchObject({ customerId: true, binId: true });
    // Moving the customer back clears the pick; the saved bin is a pick away.
    state.options = [NORTH];
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "customer-one" } });
    await waitFor(() => expect(form().getValues("binId")).toBe("north"));
    expect(probe.dirty).toBe(false);
  });
});

interface RowValues { rows: { binId: string }[] }

function RowsPicker({ expose }: { expose: (form: UseFormReturn<RowValues>) => void }) {
  const form = useForm<RowValues>({ defaultValues: { rows: [{ binId: "" }] } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "rows" });
  expose(form);
  return (
    <>
      {fields.map((row, index) => (
        <FormEntitySelect key={row.id} control={form.control} name={`rows.${index}.binId`} label="Storage bin" entityType="storageLocation" required />
      ))}
      <button type="button" onClick={() => append({ binId: "" })}>Add row</button>
      <button type="button" onClick={() => remove(fields.length - 1)}>Remove last row</button>
      <DirtyProbe control={form.control} />
    </>
  );
}

describe("FormEntitySelect auto-pick in a field array row", () => {
  it("keeps a row present at mount clean, keeps an added row dirty, and is clean again once that row goes", async () => {
    let form!: UseFormReturn<RowValues>;
    render(<RowsPicker expose={(value) => { form = value; }} />);
    await waitFor(() => expect(form.getValues("rows.0.binId")).toBe("north"));
    expect(probe.dirty).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    await waitFor(() => expect(form.getValues("rows.1.binId")).toBe("north"));
    expect(probe.dirty).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove last row" }));
    await waitFor(() => expect(probe.dirty).toBe(false));
  });
});
