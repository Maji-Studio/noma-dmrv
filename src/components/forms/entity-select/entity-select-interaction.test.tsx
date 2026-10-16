// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntitySelect } from "./entity-select";
import { FormEntitySelect } from "./form-entity-select";
import { useController, useForm } from "react-hook-form";
import { Modal } from "@/components/ui/modal/modal";
import { FormField } from "../form-field";
import type { EntityOption, EntityType } from "./types";
import { ENTITY_SEARCH_LIMIT } from "@/config/forms";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { STRICT_FORMULATION_MATCH } from "@/schemas/biochar-products";

const state = vi.hoisted(() => ({ permissionChecks: 0, dialogMounts: [] as string[], listEnabled: [] as boolean[], detailIds: [] as (string | undefined)[], options: [] as EntityOption[], loading: false, canManage: false, error: null as Error | null, selected: undefined as EntityOption | undefined }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: ({ search, enabled }: { search: string; enabled: boolean }) => {
    state.listEnabled.push(enabled);
    return {
      data: state.options.filter((option) => [option.name, option.code].some((text) => text.toLowerCase().includes(search.toLowerCase()))),
      isLoading: state.loading,
      error: state.error,
    };
  },
  useEntityById: (_type: string, id: string | undefined) => {
    state.detailIds.push(id);
    return { data: state.selected ?? { id: "one", code: "1", name: "North bin" }, isPending: false };
  },
}));
vi.mock("./driver-quick-add-dialog", () => ({ DriverQuickAddDialog: (props: TestQuickAddDialogProps) => { state.dialogMounts.push("Driver"); return <TestQuickAddDialog {...props} />; } }));
vi.mock("./operator-quick-add-dialog", () => ({ OperatorQuickAddDialog: (props: TestQuickAddDialogProps) => { state.dialogMounts.push("Operator"); return <TestQuickAddDialog {...props} />; } }));
vi.mock("./vehicle-quick-add-dialog", () => ({ VehicleQuickAddDialog: (props: TestQuickAddDialogProps) => { state.dialogMounts.push("Vehicle"); return <TestQuickAddDialog {...props} />; } }));
vi.mock("./feedstock-type-quick-add-dialog", () => ({ FeedstockTypeQuickAddDialog: (props: TestQuickAddDialogProps) => { state.dialogMounts.push("FeedstockType"); return <TestQuickAddDialog {...props} />; } }));
vi.mock("./formulation-quick-add-dialog", () => ({ FormulationQuickAddDialog: (props: TestQuickAddDialogProps) => { state.dialogMounts.push("Formulation"); return <TestQuickAddDialog {...props} />; } }));
vi.mock("@/hooks/use-entity-edit-record", () => ({
  isEditableEntityType: (type: string) => !["facility", "creditBatch"].includes(type),
  useCanManageFeedstockTypes: () => { state.permissionChecks += 1; return state.canManage; },
}));
vi.mock("./entity-edit-dialog", () => ({
  EntityEditDialog: ({ entityId, onClose }: { entityId: string; onClose: () => void }) => (
    <button type="button" data-testid="shared-edit-dialog" onClick={onClose}>{entityId}</button>
  ),
}));
const scroll = vi.fn();
let finePointer = true;
beforeEach(() => {
  state.options = [{ id: "one", code: "1", name: "North bin" }, { id: "two", code: "2", name: "South bin" }];
  state.listEnabled = [];
  state.detailIds = [];
  state.permissionChecks = 0;
  state.dialogMounts = [];
  state.loading = false;
  state.canManage = false;
  state.error = null;
  state.selected = undefined;
  finePointer = true;
  scroll.mockClear();
  Element.prototype.scrollIntoView = scroll;
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: finePointer, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);
const trigger = () => screen.getByTestId("entity-select-trigger");
const open = () => fireEvent.click(trigger());
const key = (key: string) => fireEvent.keyDown(document.activeElement === screen.queryByTestId("entity-select-search") ? document.activeElement! : trigger(), { key });
function activeTestId() {
  return document.getElementById(trigger().getAttribute("aria-activedescendant")!)?.getAttribute("data-testid");
}

describe("EntitySelect trailing icons", () => {
  it.each([
    { value: "", disabled: false, selectionLocked: false, padding: "pr-36", hasClear: false },
    { value: "one", disabled: false, selectionLocked: false, padding: "pr-72", hasClear: true },
    { value: "one", disabled: true, selectionLocked: false, padding: "pr-36", hasClear: false },
    { value: "one", disabled: false, selectionLocked: true, padding: "pr-36", hasClear: false },
  ])("reserves $padding with value '$value', disabled $disabled, locked $selectionLocked", ({ value, disabled, selectionLocked, padding, hasClear }) => {
    render(<EntitySelect options={state.options} value={value} disabled={disabled} selectionLocked={selectionLocked} onChange={vi.fn()} />);
    const field = trigger();
    const caret = field.querySelector("[data-trailing-icon]");

    expect(field.getAttribute("data-has-value")).toBe(String(Boolean(value)));
    expect(field.classList.contains("px-12")).toBe(true);
    expect(field.classList.contains(padding)).toBe(true);
    expect(field.classList.contains("pr-80")).toBe(false);
    for (const className of ["absolute", "right-12", "size-16", "pointer-events-none"])
      expect(caret?.classList.contains(className)).toBe(true);
    expect(field.parentElement?.classList.contains("relative")).toBe(true);

    const clear = screen.queryByTestId("entity-select-clear");
    if (hasClear) {
      expect(clear).not.toBeNull();
      for (const className of ["absolute", "right-28", "h-44", "w-44", "justify-end", "pr-8"])
        expect(clear?.classList.contains(className)).toBe(true);
    } else expect(clear).toBeNull();
  });
});

function LockedFormPicker() {
  const { control } = useForm({ defaultValues: { binId: "one" } });
  return <FormEntitySelect control={control} name="binId" label="Storage bin" entityType="storageLocation" selectionLocked onEditSelected={vi.fn()} />;
}

const requiredPickerSchema = z.object({ binId: z.string().min(1, "Select a storage bin.") });
interface TestQuickAddDialogProps { isOpen: boolean; onClose: () => void }
function TestQuickAddDialog({ isOpen, onClose }: TestQuickAddDialogProps) {
  return <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Quick-add entity">
    <input aria-label="Entity name" />
    <input aria-label="Entity code" />
    <button type="button" onClick={onClose}>Cancel</button>
  </Modal>;
}

function QuickAddFormPicker({ entityType, onBlur }: { entityType: EntityType; onBlur: () => void }) {
  const { control } = useForm({ defaultValues: { binId: "" }, resolver: zodResolver(requiredPickerSchema), mode: "onTouched" });
  const { field, fieldState } = useController({ control, name: "binId" });
  return <>
    <FormField id="required-entity" label="Required entity" required error={fieldState.error?.message}>
      <EntitySelect id="required-entity" entityType={entityType} value={field.value} onChange={field.onChange} onBlur={() => { onBlur(); field.onBlur(); }} allowCreate alwaysShowSearch />
    </FormField>
    <button type="button">Outside picker</button>
  </>;
}

function TouchedFormPicker({ alwaysShowSearch }: { alwaysShowSearch: boolean }) {
  const { control } = useForm({
    defaultValues: { binId: "" },
    resolver: zodResolver(requiredPickerSchema),
    mode: "onTouched",
  });
  return <>
    <FormEntitySelect control={control} name="binId" label="Storage bin" entityType="storageLocation" required autoSelectSingle={false} alwaysShowSearch={alwaysShowSearch} />
    <button type="button">Outside picker</button>
  </>;
}

describe("EntitySelect touched validation", () => {
  it.each(["driver", "operator", "vehicle", "feedstockType", "formulation"] as const)("does not blur or validate a required picker while its %s quick-add dialog has focus", async (entityType) => {
    const blur = vi.fn();
    const { container } = render(<QuickAddFormPicker entityType={entityType} onBlur={blur} />);
    act(() => trigger().focus()); open();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("entity-select-search")));
    fireEvent.click(screen.getByTestId("entity-select-create"));
    await screen.findByRole("dialog", { name: "Quick-add entity" });
    expect(container.contains(screen.getByRole("textbox", { name: "Entity name" }))).toBe(false);
    expect(blur).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole("textbox", { name: "Entity name" }).focus(); });
    expect(blur).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole("textbox", { name: "Entity code" }).focus(); });
    expect(blur).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => { screen.getByRole("button", { name: "Cancel" }).focus(); });
    expect(blur).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Quick-add entity" })).toBeNull());
    expect(blur).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => { trigger().focus(); });
    await act(async () => { screen.getByRole("button", { name: "Outside picker" }).focus(); });
    expect(blur).toHaveBeenCalledOnce();
    expect((await screen.findByRole("alert")).textContent).toBe("Select a storage bin.");
  });

  it("notifies blur after clearing a focused prefilled closed picker and moving outside", () => {
    const blur = vi.fn(); const change = vi.fn();
    function PrefilledPicker() {
      const [value, setValue] = useState<string | undefined>("one");
      return <EntitySelect options={state.options} value={value} onChange={(next) => { setValue(next); change(next); }} onBlur={blur} />;
    }
    render(<><PrefilledPicker /><button type="button">Outside picker</button></>);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    const clear = screen.getByTestId("entity-select-clear");
    act(() => clear.focus());
    expect(document.activeElement).toBe(clear);
    fireEvent.click(clear);
    expect(change).toHaveBeenCalledExactlyOnceWith("");
    expect(screen.queryByTestId("entity-select-clear")).toBeNull();
    expect(blur).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "Outside picker" }).focus());
    expect(blur).toHaveBeenCalledOnce();
  });

  it.each([false, true])("does not validate while opening or picking with the mouse (search: %s)", async (alwaysShowSearch) => {
    render(<TouchedFormPicker alwaysShowSearch={alwaysShowSearch} />);
    act(() => trigger().focus());
    open();
    if (alwaysShowSearch) await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("entity-select-search")));
    expect(screen.queryByRole("alert")).toBeNull();
    const option = screen.getByTestId("entity-option-two");
    fireEvent.pointerDown(option);
    // A non-focusable option sends focus to the body before its click.
    await act(async () => { (document.activeElement as HTMLElement).blur(); });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { fireEvent.click(option); });
    expect(trigger().textContent).toBe("South bin");
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { screen.getByRole("button", { name: "Outside picker" }).focus(); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    { dismissal: "Escape", search: false }, { dismissal: "Escape", search: true },
    { dismissal: "outside", search: false }, { dismissal: "outside", search: true },
  ])("validates an empty picker dismissed by $dismissal (search: $search)", async ({ dismissal, search }) => {
    render(<TouchedFormPicker alwaysShowSearch={search} />);
    act(() => trigger().focus()); open();
    if (search) await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("entity-select-search")));
    expect(screen.queryByRole("alert")).toBeNull();
    if (dismissal === "Escape") key("Escape");
    else fireEvent.pointerDown(screen.getByRole("button", { name: "Outside picker" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Select a storage bin.");
    expect(screen.queryByTestId("entity-select-listbox")).toBeNull();
  });

  it("notifies direct callers only when focus leaves the trigger and portal", async () => {
    const blur = vi.fn();
    render(<><EntitySelect options={state.options} onChange={vi.fn()} onBlur={blur} alwaysShowSearch /><button type="button">Outside picker</button></>);
    act(() => trigger().focus()); open();
    const search = await screen.findByTestId("entity-select-search");
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(blur).not.toHaveBeenCalled();
    act(() => trigger().focus());
    act(() => search.focus());
    expect(blur).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "Outside picker" }).focus());
    expect(blur).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("entity-select-listbox")).toBeNull();
  });
});

// Chromium carries :focus-visible over to a scripted focus() from a search
// input, and an already focused trigger keeps a ring set by earlier typing.
// jsdom has no :focus-visible, so these tests pin where the trigger's focus
// comes from and the focusVisible option it is given.
describe("EntitySelect focus return after a pick", () => {
  function recordTriggerFocus() {
    const from: (EventTarget | null)[] = [];
    trigger().addEventListener("focus", (event) => from.push(event.relatedTarget));
    return { from, focus: vi.spyOn(trigger(), "focus") };
  }

  it.each([false, true])("refocuses the trigger from the body after a pointer pick (search: %s)", async (alwaysShowSearch) => {
    const change = vi.fn(); const blur = vi.fn();
    render(<EntitySelect options={state.options} onChange={change} onBlur={blur} alwaysShowSearch={alwaysShowSearch} />);
    act(() => trigger().focus()); open();
    if (alwaysShowSearch) await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("entity-select-search")));
    const focusFrom = recordTriggerFocus();
    const option = screen.getByTestId("entity-option-two");
    fireEvent.pointerDown(option);
    await act(async () => { fireEvent.click(option); });
    expect(change).toHaveBeenCalledExactlyOnceWith("two");
    expect(document.activeElement).toBe(trigger());
    expect(focusFrom.from).toEqual([null]);
    expect(focusFrom.focus).toHaveBeenCalledWith({ focusVisible: false });
    expect(blur).not.toHaveBeenCalled();
  });

  it("moves keyboard focus straight from search to the trigger on Enter", async () => {
    const change = vi.fn();
    render(<EntitySelect options={state.options} onChange={change} alwaysShowSearch />);
    act(() => trigger().focus()); open();
    const search = await screen.findByTestId("entity-select-search");
    await waitFor(() => expect(document.activeElement).toBe(search));
    const focusFrom = recordTriggerFocus();
    key("ArrowDown"); key("Enter");
    expect(change).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger());
    expect(focusFrom.from).toEqual([search]);
    expect(focusFrom.focus).not.toHaveBeenCalledWith({ focusVisible: false });
  });

  it("keeps the selected tint on a highlighted selected row", () => {
    render(<EntitySelect options={state.options} value="one" onChange={vi.fn()} />);
    open();
    const highlight = "data-[highlighted]:bg-[var(--color-background-medium)]";
    expect(screen.getByTestId("entity-option-one").className).toContain("bg-[var(--color-background-interaction-light)]");
    expect(screen.getByTestId("entity-option-one").className).not.toContain(highlight);
    expect(screen.getByTestId("entity-option-two").className).toContain(highlight);
  });
});

function AutoSelectPicker({ dependsOn, filterBy }: { dependsOn?: string; filterBy?: Record<string, string> }) {
  const [value, setValue] = useState<string | undefined>("");
  return <EntitySelect options={[state.options[0]]} value={value} onChange={setValue} autoSelectSingle dependsOn={dependsOn} filterBy={filterBy} noneOption={{ label: "None" }} />;
}

describe("EntitySelect automatic selection after clear", () => {
  it.each(["clear", "none"])("keeps a user %s until dependsOn changes", async (method) => {
    const view = render(<AutoSelectPicker dependsOn="customer-one" />);
    await waitFor(() => expect(trigger().textContent).toBe("North bin"));
    if (method === "clear") fireEvent.click(screen.getByTestId("entity-select-clear"));
    else { open(); fireEvent.click(screen.getByTestId("entity-select-none")); }
    expect(trigger().textContent).toBe("None");
    view.rerender(<AutoSelectPicker dependsOn="customer-one" />);
    open(); key("Escape");
    expect(trigger().textContent).toBe("None");
    view.rerender(<AutoSelectPicker dependsOn="customer-two" />);
    await waitFor(() => expect(trigger().textContent).toBe("North bin"));
  });

  it("resets on changed filter values, rather than a new filter object", async () => {
    const view = render(<AutoSelectPicker filterBy={{ customerId: "one", facilityId: "facility" }} />);
    await waitFor(() => expect(trigger().textContent).toBe("North bin"));
    fireEvent.click(screen.getByTestId("entity-select-clear"));
    view.rerender(<AutoSelectPicker filterBy={{ facilityId: "facility", customerId: "one" }} />);
    expect(trigger().textContent).toBe("None");
    view.rerender(<AutoSelectPicker filterBy={{ customerId: "two", facilityId: "facility" }} />);
    await waitFor(() => expect(trigger().textContent).toBe("North bin"));
  });
});

describe("EntitySelect menu interactions", () => {
  it("keeps the menu open and untouched when pressing its sibling Clear button", () => {
    const change = vi.fn(); const blur = vi.fn();
    render(<EntitySelect options={state.options} value="one" onChange={change} onBlur={blur} />);
    act(() => trigger().focus()); open();
    const clear = screen.getByRole("button", { name: "Clear selection" });
    fireEvent.pointerDown(clear);
    fireEvent.click(clear);
    expect(change).toHaveBeenCalledExactlyOnceWith("");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(blur).not.toHaveBeenCalled();
  });

  it("opens at the last row with ArrowUp without selecting an action", async () => {
    const change = vi.fn(); const create = vi.fn();
    render(<EntitySelect options={state.options} value="one" onChange={change} allowCreate onCreateNew={create} hideSearch />);
    key("ArrowUp");
    await waitFor(() => expect(activeTestId()).toBe("entity-select-create"));
    const action = screen.getByRole("button", { name: "Add new option" });
    expect(action.hasAttribute("aria-selected")).toBe(false);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    key("Enter");
    expect(create).toHaveBeenCalledOnce();
    expect(change).not.toHaveBeenCalled();
    expect(trigger().textContent).toBe("North bin");
  });

  it("keeps server code matches and a rich selected label while searching", async () => {
    const change = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" onChange={change} alwaysShowSearch formatSelectedLabel={(option) => <strong>{option.name} (+100 kg wet)</strong>} />);
    open();
    const search = screen.getByRole("combobox", { name: "Search storage bin" });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: "2" } });
    await waitFor(() => expect(screen.queryByTestId("entity-option-one")).toBeNull());
    expect(screen.getByTestId("entity-option-two").textContent).toBe("South bin");
    expect(trigger().querySelector("strong")?.textContent).toBe("North bin (+100 kg wet)");
    key("Enter");
    expect(change).toHaveBeenCalledExactlyOnceWith("two");
  });

  it("selects with the keyboard when focus is inside the list", () => {
    const change = vi.fn();
    render(<EntitySelect options={state.options} onChange={change} hideSearch />);
    key("ArrowDown");
    const list = screen.getByRole("listbox", { name: "option options" });
    act(() => list.focus());
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(change).toHaveBeenCalledExactlyOnceWith("two");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it.each([{ value: undefined, edit: true }, { value: "one", edit: false }])("requires selection and callback: %s", ({ value, edit }) => {
    render(<EntitySelect entityType="storageLocation" value={value} onChange={vi.fn()} onEditSelected={edit ? vi.fn() : undefined} />);
    open();
    expect(screen.queryByTestId("entity-select-edit")).toBeNull();
  });

  it("opens the shared edit dialog with allowEdit and preserves selection", async () => {
    const change = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" selectionLocked allowEdit onChange={change} />);
    open(); key("Enter");
    await waitFor(() => expect(screen.getByTestId("shared-edit-dialog").textContent).toBe("one"));
    expect(change).not.toHaveBeenCalled();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByTestId("shared-edit-dialog"));
    expect(screen.queryByTestId("shared-edit-dialog")).toBeNull();
  });

  it("gives a custom edit callback precedence over allowEdit", () => {
    const edit = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" allowEdit onChange={vi.fn()} onEditSelected={edit} />);
    open(); fireEvent.click(screen.getByTestId("entity-select-edit"));
    expect(edit).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("shared-edit-dialog")).toBeNull();
  });

  it("does not invoke Add new on Enter without an explicit highlight", () => {
    state.options = [];
    const create = vi.fn();
    render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} allowCreate onCreateNew={create} />);
    open(); key("Enter");
    expect(create).not.toHaveBeenCalled();
    key("ArrowDown"); key("Enter");
    expect(create).toHaveBeenCalledOnce();
  });

  it("uses the name, closes on edit and leaves the value unchanged", () => {
    const change = vi.fn(); const edit = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" onChange={change} onEditSelected={edit} formatSelectedLabel={() => <strong>Decorated stock label</strong>} />);
    open();
    expect(screen.getByTestId("entity-select-edit").textContent).toBe("Edit North bin");
    expect(screen.getAllByRole("option")[0].textContent).toBe("North bin");
    fireEvent.click(screen.getByTestId("entity-select-edit"));
    expect(edit).toHaveBeenCalledOnce();
    expect(change).not.toHaveBeenCalled();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("offers a View row and an (Archived) label for an archived formulation selection", () => {
    const edit = vi.fn();
    state.selected = { id: "one", code: "BCF-1", name: "Archived blend", subtitle: "Archived", archived: true };
    render(<EntitySelect entityType="formulation" value="one" onChange={vi.fn()} onEditSelected={edit} />);
    expect(trigger().textContent).toContain("Archived blend (Archived)");
    open();
    expect(screen.getByTestId("entity-select-edit").textContent).toBe("View Archived blend");
    fireEvent.click(screen.getByTestId("entity-select-edit"));
    expect(edit).toHaveBeenCalledOnce();
  });

  it("supports a custom Edit label", () => {
    render(<EntitySelect entityType="storageLocation" value="one" onChange={vi.fn()} onEditSelected={vi.fn()} editLabel="Edit selected bin" />);
    open();
    expect(screen.getByTestId("entity-select-edit").textContent).toBe("Edit selected bin");
  });

  it("keeps an ordinary disabled picker closed", () => {
    render(<EntitySelect entityType="storageLocation" value="one" disabled onChange={vi.fn()} onEditSelected={vi.fn()} />);
    open(); key("ArrowDown");
    expect(screen.queryByTestId("entity-select-listbox")).toBeNull();
  });

  it("keeps the parent modal open when choosing a portalled option or pressing Escape", async () => {
    const close = vi.fn(); const change = vi.fn();
    render(<Modal isOpen onClose={close} ariaLabel="Entry form">
      <EntitySelect entityType="storageLocation" onChange={change} alwaysShowSearch />
    </Modal>);
    open();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("entity-select-search")));
    fireEvent.pointerDown(screen.getByTestId("entity-option-two"));
    fireEvent.click(screen.getByTestId("entity-option-two"));
    expect(change).toHaveBeenCalledWith("two");
    expect(document.activeElement).toBe(trigger());
    expect(close).not.toHaveBeenCalled();
    open(); key("Escape");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(close).not.toHaveBeenCalled();
  });

  it("reads the navigable item's DOM id without assuming Base UI's id format", async () => {
    const options = [{ id: "disabled", code: "0", name: "Unavailable bin", disabled: true }, ...state.options];
    render(<EntitySelect options={options} onChange={vi.fn()} />);
    open();
    await waitFor(() => expect(activeTestId()).toBe("entity-option-one"));
    const nextOption = screen.getByTestId("entity-option-two");
    nextOption.id = "custom-option-id";
    key("ArrowDown");
    expect(trigger().getAttribute("aria-activedescendant")).toBe(nextOption.id);
    expect(activeTestId()).toBe("entity-option-two");
  });

  it("walks none, options, edit, create in order and activates Edit", async () => {
    const edit = vi.fn(); const change = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" onChange={change} onEditSelected={edit} noneOption={{ label: "None" }} allowCreate onCreateNew={vi.fn()} />);
    key("ArrowDown");
    await waitFor(() => expect(activeTestId()).toBe("entity-select-none"));
    for (const id of ["entity-option-one", "entity-option-two", "entity-select-edit", "entity-select-create"]) {
      key("ArrowDown"); expect(activeTestId()).toBe(id);
    }
    key("Home"); expect(activeTestId()).toBe("entity-select-none");
    key("End"); key("ArrowUp"); key("Enter");
    expect(edit).toHaveBeenCalledOnce(); expect(change).not.toHaveBeenCalled();
  });

  it("forwards the selection lock through the form wrapper", () => {
    render(<LockedFormPicker />);
    open();
    expect(trigger().getAttribute("aria-readonly")).toBe("true");
    expect(screen.getByTestId("entity-select-edit")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("offers only Edit when locked", () => {
    const edit = vi.fn(); const change = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" selectionLocked onChange={change} onEditSelected={edit} noneOption={{ label: "None" }} allowCreate onCreateNew={vi.fn()} alwaysShowSearch />);
    open();
    expect(trigger().getAttribute("aria-readonly")).toBe("true");
    expect(trigger().className).toContain("opacity-50");
    expect(trigger().className).not.toContain("hover:border");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByTestId("entity-select-create")).toBeNull();
    expect(screen.queryByTestId("entity-select-search")).toBeNull();
    expect(screen.queryByTestId("entity-select-clear")).toBeNull();
    key("Enter"); expect(edit).toHaveBeenCalledOnce(); expect(change).not.toHaveBeenCalled();
  });

  it("selects the first search match after Edit was highlighted", async () => {
    const change = vi.fn(); const edit = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" onChange={change} onEditSelected={edit} alwaysShowSearch />);
    open();
    const search = screen.getByTestId("entity-select-search");
    await waitFor(() => expect(document.activeElement).toBe(search));
    key("ArrowDown"); key("ArrowDown");
    expect(activeTestId()).toBe("entity-select-edit");
    fireEvent.change(search, { target: { value: "South" } });
    expect(activeTestId()).toBe("entity-option-one");
    await waitFor(() => expect(screen.queryByTestId("entity-option-one")).toBeNull());
    key("Enter");
    expect(change).toHaveBeenCalledExactlyOnceWith("two");
    expect(edit).not.toHaveBeenCalled();
  });

  it("does not open Edit on Enter when a search has no matches", async () => {
    const change = vi.fn(); const edit = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" onChange={change} onEditSelected={edit} alwaysShowSearch />);
    open();
    const search = screen.getByTestId("entity-select-search");
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: "zzz" } });
    await waitFor(() => expect(screen.queryByTestId("entity-option-two")).toBeNull());
    key("Enter");
    expect(edit).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });

  it.each(["Home", "End"])("leaves %s to the search input's native caret behavior", async (navigationKey) => {
    const change = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" onChange={change} onEditSelected={vi.fn()} alwaysShowSearch />);
    open();
    const search = screen.getByTestId("entity-select-search");
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: "bin" } });
    key("ArrowDown");
    expect(activeTestId()).toBe("entity-option-two");
    // jsdom has no native caret movement; an uncancelled key leaves it to the browser.
    expect(fireEvent.keyDown(search, { key: navigationKey })).toBe(true);
    expect(activeTestId()).toBe("entity-option-two");
    key("ArrowUp"); key("Enter");
    expect(change).toHaveBeenCalledExactlyOnceWith("one");
  });

  it.each([false, true])("tabs from the trigger into the portalled recovery link (modal: %s)", async (inModal) => {
    state.options = [];
    const close = vi.fn();
    const fields = <>
      <EntitySelect entityType="storageLocation" onChange={vi.fn()} emptyHint={{ message: "Create a bin first", href: "/storage-locations", linkLabel: "Create storage bin" }} />
      <input aria-label="Next field" />
    </>;
    render(inModal ? <Modal isOpen onClose={close} ariaLabel="Entry form">{fields}</Modal> : fields);
    if (inModal) await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" })));
    trigger().focus();
    key("ArrowDown");
    expect(screen.queryByTestId("entity-select-search")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    fireEvent.keyDown(trigger(), { key: "Tab" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Create storage bin" })));
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(close).not.toHaveBeenCalled();
  });

  it.each([false, true])("returns focus from search on Tab (shift: %s)", async (shiftKey) => {
    render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} alwaysShowSearch />);
    open();
    const search = screen.getByTestId("entity-select-search");
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(fireEvent.keyDown(search, { key: "Tab", shiftKey })).toBe(false);
    expect(screen.queryByTestId("entity-select-listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(fireEvent.keyDown(trigger(), { key: "Tab", shiftKey })).toBe(true);
  });

  it.each([false, true])("returns focus from the recovery link on Tab (shift: %s)", async (shiftKey) => {
    state.options = [];
    render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} emptyHint={{ message: "Create a bin first", href: "/storage-locations" }} />);
    trigger().focus(); open();
    fireEvent.keyDown(trigger(), { key: "Tab" });
    const link = screen.getByRole("link");
    await waitFor(() => expect(document.activeElement).toBe(link));
    expect(fireEvent.keyDown(link, { key: "Tab", shiftKey })).toBe(false);
    expect(screen.queryByTestId("entity-select-listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(fireEvent.keyDown(trigger(), { key: "Tab", shiftKey })).toBe(true);
  });

  it("lets disabled override a selection lock", () => {
    render(<EntitySelect entityType="storageLocation" value="one" disabled selectionLocked onChange={vi.fn()} onEditSelected={vi.fn()} />);
    open(); key("Enter");
    expect(screen.queryByTestId("entity-select-listbox")).toBeNull();
  });

  it.each([5, 6])("shows search from six options (%i)", (count) => {
    state.options = Array.from({ length: count }, (_, i) => ({ id: String(i), code: String(i), name: `Bin ${i}` }));
    render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} />); open();
    expect(Boolean(screen.queryByTestId("entity-select-search"))).toBe(count === 6);
  });

  it.each([false, true])("focuses newly loaded search only for a fine pointer (touch: %s)", async (touch) => {
    finePointer = !touch;
    const change = vi.fn();
    const view = render(<EntitySelect options={[]} isLoading onChange={change} />);
    act(() => trigger().focus()); open();
    // Let the popup's initial-focus microtasks finish before the query resolves.
    await act(async () => {});
    expect(document.activeElement).toBe(trigger());
    expect(screen.queryByTestId("entity-select-search")).toBeNull();
    const options = Array.from({ length: 6 }, (_, index) => ({ id: String(index), code: String(index), name: `Bin ${index}` }));
    view.rerender(<EntitySelect options={options} onChange={change} />);
    await waitFor(() => expect(document.activeElement).toBe(touch ? trigger() : screen.getByTestId("entity-select-search")));
  });

  it("does not steal focus from the list when loaded options reveal search", async () => {
    const change = vi.fn();
    const view = render(<EntitySelect options={[]} isLoading onChange={change} />);
    act(() => trigger().focus()); open();
    await act(async () => {});
    const list = screen.getByTestId("entity-select-listbox");
    act(() => list.focus());
    expect(document.activeElement).toBe(list);
    const options = Array.from({ length: 6 }, (_, index) => ({ id: String(index), code: String(index), name: `Bin ${index}` }));
    view.rerender(<EntitySelect options={options} onChange={change} />);
    await act(async () => {});
    expect(screen.getByTestId("entity-select-search")).toBeTruthy();
    expect(document.activeElement).toBe(list);
  });

  it.each([{ alwaysShowSearch: true }, { hideSearch: true, alwaysShowSearch: true }])("honors search overrides: %s", (props) => {
    render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} {...props} />); open();
    expect(Boolean(screen.queryByTestId("entity-select-search"))).toBe(!props.hideSearch);
  });

  it("keeps touch focus on the trigger, portals the menu, and dismisses on outside pointerdown", () => {
    finePointer = false;
    const { container } = render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} alwaysShowSearch />);
    trigger().focus(); open();
    expect(document.activeElement).toBe(trigger());
    expect(container.contains(screen.getByTestId("entity-select-listbox"))).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("does not focus search for a touch press on a hybrid device", () => {
    render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} alwaysShowSearch />);
    trigger().focus();
    const touch = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    fireEvent(trigger(), touch);
    open();
    expect(document.activeElement).toBe(trigger());
  });

  it("focuses search on fine pointers, clears search after edit, and restores focus on Escape", async () => {
    render(<EntitySelect entityType="storageLocation" value="one" onChange={vi.fn()} onEditSelected={vi.fn()} alwaysShowSearch />);
    open();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("entity-select-search")));
    fireEvent.change(screen.getByTestId("entity-select-search"), { target: { value: "query" } });
    fireEvent.click(screen.getByTestId("entity-select-edit")); open();
    expect((screen.getByTestId("entity-select-search") as HTMLInputElement).value).toBe("");
    key("Escape"); expect(document.activeElement).toBe(trigger());
  });

  it("scrolls the action by id when an empty hint precedes it", () => {
    state.options = [];
    render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} onCreateNew={vi.fn()} emptyHint={{ message: "Create a bin first" }} />); open();
    key("ArrowDown");
    expect(activeTestId()).toBe("entity-select-create");
    expect(scroll.mock.contexts.at(-1)).toBe(screen.getByTestId("entity-select-create"));
  });
});

it("shows feedstock-type Edit only with management permission", () => {
  const props = { entityType: "feedstockType" as const, value: "one", allowEdit: true, onChange: vi.fn(), onEditSelected: vi.fn() };
  const view = render(<EntitySelect {...props} />);
  open(); expect(screen.queryByTestId("entity-select-edit")).toBeNull();
  state.canManage = true; view.rerender(<EntitySelect {...props} />);
  expect(screen.getByTestId("entity-select-edit")).toBeTruthy();
  fireEvent.click(screen.getByTestId("entity-select-edit"));
  expect(props.onEditSelected).toHaveBeenCalledOnce();
});

describe("EntitySelect caller-owned options", () => {
  const localOptions: EntityOption[] = [
    { id: "pending", code: "DL-01", name: "Pending load", subtitle: "not yet delivered", disabled: true },
    { id: "shipped", code: "DL-02", name: "South field", subtitle: "Maize" },
    { id: "other", code: "DL-03", name: "North field", subtitle: "Coffee" },
  ];

  it.each(["storageLocation", "feedstockType"] as const)("ignores built-in edit and create in local %s mode without mounting queries or dialogs", (entityType) => {
    state.canManage = true;
    render(<EntitySelect entityType={entityType} options={localOptions} value="shipped" allowEdit allowCreate onChange={vi.fn()} />);
    open();
    expect(screen.queryByTestId("entity-select-edit")).toBeNull();
    expect(screen.queryByTestId("entity-select-create")).toBeNull();
    expect(state.listEnabled).toEqual([]);
    expect(state.detailIds).toEqual([]);
    expect(state.permissionChecks).toBe(0);
    expect(state.dialogMounts).toEqual([]);
  });

  it.each([
    { value: "prj_saved", placeholder: "Select a project", selectedLabel: undefined, expected: "prj_saved" },
    { value: "prj_saved", placeholder: "Select a project", selectedLabel: "Saved project", expected: "Saved project" },
    { value: "tpl_saved", placeholder: "No default", selectedLabel: undefined, expected: "tpl_saved" },
  ])("shows a missing saved value as $expected without entity queries", ({ value, placeholder, selectedLabel, expected }) => {
    const change = vi.fn();
    const { rerender } = render(<EntitySelect options={localOptions} value={value} selectedLabel={selectedLabel} placeholder={placeholder} onChange={change} autoSelectSingle />);
    expect(trigger().textContent).toBe(expected);
    open();
    expect(screen.queryByTestId(`entity-option-${value}`)).toBeNull();
    expect(change).not.toHaveBeenCalled();
    rerender(<EntitySelect options={[]} value={value} selectedLabel={selectedLabel} placeholder={placeholder} onChange={change} isLoading />);
    expect(trigger().textContent).toBe(expected);
    rerender(<EntitySelect options={[]} value={value} selectedLabel={selectedLabel} placeholder={placeholder} onChange={change} loadError={new Error("Registry unavailable")} />);
    expect(trigger().textContent).toBe(expected);
    expect(state.listEnabled).toEqual([]);
    expect(state.detailIds).toEqual([]);
    fireEvent.click(screen.getByTestId("entity-select-clear"));
    expect(change).toHaveBeenCalledExactlyOnceWith("");
    rerender(<EntitySelect options={[]} selectedLabel={selectedLabel} placeholder={placeholder} onChange={change} />);
    expect(trigger().textContent).toBe(placeholder);
  });

  it("can switch between local and server sources without conditional hooks", () => {
    const change = vi.fn();
    const { rerender } = render(<EntitySelect entityType="storageLocation" options={localOptions} value="shipped" onChange={change} />);
    expect(trigger().textContent).toBe("South field");
    expect(state.listEnabled).toEqual([]);
    expect(state.detailIds).toEqual([]);
    rerender(<EntitySelect entityType="storageLocation" value="one" onChange={change} />);
    expect(trigger().textContent).toBe("North bin");
    expect(state.listEnabled.length).toBeGreaterThan(0);
    expect(state.detailIds).toContain("one");
    state.listEnabled = [];
    state.detailIds = [];
    rerender(<EntitySelect entityType="storageLocation" options={localOptions} value="shipped" onChange={change} />);
    open();
    fireEvent.click(screen.getByTestId("entity-option-other"));
    expect(change).toHaveBeenCalledExactlyOnceWith("other");
    expect(state.listEnabled).toEqual([]);
    expect(state.detailIds).toEqual([]);
  });

  it("prefers the current option label over the saved label", () => {
    render(<EntitySelect options={localOptions} value="shipped" selectedLabel="Old field name" onChange={vi.fn()} />);
    expect(trigger().textContent).toBe("South field");
  });

  it("filters locally by name, code and subtitle without entity queries", () => {
    const { rerender } = render(<EntitySelect options={localOptions} optionLabel="delivery" value="shipped" onChange={vi.fn()} alwaysShowSearch />);
    expect(trigger().textContent).toContain("South field");
    open();
    const search = screen.getByTestId("entity-select-search");
    for (const query of ["south", "DL-02", "maIZE"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByTestId("entity-option-shipped")).toBeTruthy();
      expect(trigger().textContent).toContain("South field");
    }
    fireEvent.change(search, { target: { value: "not found" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(trigger().textContent).toContain("South field");
    rerender(<EntitySelect options={localOptions.map((option) => ({ ...option, name: "Updated label" }))} value="shipped" onChange={vi.fn()} alwaysShowSearch />);
    expect(trigger().textContent).toContain("Updated label");
    expect(state.listEnabled).toEqual([]);
    expect(state.detailIds).toEqual([]);
  });

  it("shows disabled options and their reason but skips click and keyboard selection", () => {
    const change = vi.fn();
    render(<EntitySelect options={localOptions} onChange={change} />);
    open();
    const pending = screen.getByTestId("entity-option-pending");
    expect(pending.getAttribute("aria-disabled")).toBe("true");
    expect(pending.textContent).toContain("not yet delivered");
    fireEvent.click(pending);
    expect(change).not.toHaveBeenCalled();
    expect(activeTestId()).toBe("entity-option-shipped");
    key("ArrowUp"); expect(activeTestId()).toBe("entity-option-shipped");
    key("ArrowDown"); expect(activeTestId()).toBe("entity-option-other");
    key("Home"); key("Enter");
    expect(change).toHaveBeenCalledExactlyOnceWith("shipped");
  });

  it("cannot auto-select or keyboard-select a list containing only a disabled option", () => {
    const change = vi.fn();
    render(<EntitySelect options={[localOptions[0]]} onChange={change} autoSelectSingle />);
    open(); key("ArrowDown"); key("Enter");
    expect(trigger().getAttribute("aria-activedescendant")).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it("renders caller loading and errors instead of selectable retained options", () => {
    const { rerender } = render(<EntitySelect options={localOptions} onChange={vi.fn()} isLoading />);
    open();
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    rerender(<EntitySelect options={localOptions} onChange={vi.fn()} loadError={new Error("Registry unavailable")} />);
    expect(screen.getByText("Error loading options")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("keeps a valid optional field neutral when its list fails to load", () => {
    const loadError = new Error("Registry unavailable");
    const view = (invalid: boolean) => (
      <FormField id="optional-template" label="Default template" error={invalid ? "Select a template." : undefined}>
        <EntitySelect id="optional-template" options={[]} onChange={vi.fn()} loadError={loadError} error={invalid} />
      </FormField>
    );
    const { rerender } = render(view(false));
    open();
    expect(screen.getByText("Error loading options")).toBeTruthy();
    expect(trigger().getAttribute("aria-invalid")).not.toBe("true");
    expect(trigger().className).not.toContain("border-[var(--color-signal-red)]");
    expect(trigger().className).toContain("border-[var(--color-border-secondary)]");
    rerender(view(true));
    expect(trigger().getAttribute("aria-invalid")).toBe("true");
    expect(trigger().className).toContain("border-[var(--color-signal-red)]");
  });

  it("renders the resolved empty state only after loading succeeds", () => {
    const { rerender } = render(<EntitySelect options={[]} onChange={vi.fn()} isLoading />);
    open();
    expect(screen.queryByTestId("entity-select-empty")).toBeNull();
    rerender(<EntitySelect options={[]} onChange={vi.fn()} loadError={new Error("Unavailable")} />);
    expect(screen.queryByTestId("entity-select-empty")).toBeNull();
    rerender(<EntitySelect options={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("entity-select-empty").textContent).toBe("No matching option records.");
    expect(screen.getByTestId("entity-select-empty").getAttribute("role")).toBe("presentation");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it.each(["storage bin", "Isometric project"])("names the empty record type (%s) and keeps search-miss guidance", (optionLabel) => {
    render(<EntitySelect options={[]} optionLabel={optionLabel} onChange={vi.fn()} alwaysShowSearch />);
    open();
    expect(screen.getByTestId("entity-select-empty").textContent).toBe(`No matching ${optionLabel} records.`);
    fireEvent.change(screen.getByTestId("entity-select-search"), { target: { value: "missing" } });
    expect(screen.getByTestId("entity-select-empty").textContent).toBe("No matches. Change or clear your search.");
  });

  it.each([
    { filterBy: { facilityId: "facility", formulationMatch: STRICT_FORMULATION_MATCH } },
    { excludeIds: ["one", "two"] },
  ])("describes an empty filtered list without claiming no records exist: %j", (filters) => {
    if ("filterBy" in filters) state.options = [];
    render(<EntitySelect entityType="storageLocation" onChange={vi.fn()} {...filters} />);
    open();
    expect(screen.getByTestId("entity-select-empty").textContent).toBe("No matching storage bin records.");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it.each([5, 6])("uses the shared search threshold for local options (%i)", (count) => {
    const options = Array.from({ length: count }, (_, i) => ({ id: String(i), code: String(i), name: `Project ${i}` }));
    render(<EntitySelect options={options} onChange={vi.fn()} />); open();
    expect(Boolean(screen.queryByTestId("entity-select-search"))).toBe(count === 6);
  });
});

describe("EntitySelect result limit hint", () => {
  it.each([ENTITY_SEARCH_LIMIT - 1, ENTITY_SEARCH_LIMIT])("shows a non-selectable hint only at the server cap (%i)", (count) => {
    state.options = Array.from({ length: count }, (_, i) => ({ id: String(i), code: String(i), name: `Bin ${i}` }));
    const change = vi.fn();
    render(<EntitySelect entityType="storageLocation" onChange={change} />); open();
    expect(Boolean(screen.queryByTestId("entity-select-more-results"))).toBe(count === ENTITY_SEARCH_LIMIT);
    const hint = screen.queryByTestId("entity-select-more-results");
    if (hint) {
      expect(hint.getAttribute("role")).toBe("presentation");
      fireEvent.click(hint);
      expect(change).not.toHaveBeenCalled();
    }
    expect(screen.getAllByRole("option")).toHaveLength(count);
    fireEvent.keyDown(trigger(), { key: "End" });
    expect(activeTestId()).toBe(`entity-option-${count - 1}`);
    key("Enter");
    expect(change).toHaveBeenCalledExactlyOnceWith(String(count - 1));
  });

  it("does not claim caller-owned lists are capped", () => {
    const options = Array.from({ length: ENTITY_SEARCH_LIMIT }, (_, i) => ({ id: String(i), code: String(i), name: `Project ${i}` }));
    render(<EntitySelect options={options} onChange={vi.fn()} />); open();
    expect(screen.queryByTestId("entity-select-more-results")).toBeNull();
  });

  it("keeps search reachable when excluded options hide the entire capped page", () => {
    state.options = Array.from({ length: ENTITY_SEARCH_LIMIT }, (_, i) => ({ id: String(i), code: String(i), name: `Bin ${i}` }));
    render(<EntitySelect entityType="storageLocation" excludeIds={state.options.map((option) => option.id)} onChange={vi.fn()} />); open();
    expect(screen.getByTestId("entity-select-more-results")).toBeTruthy();
    expect(screen.getByTestId("entity-select-search")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});


it("does not select by typeahead on a closed trigger", () => {
  const change = vi.fn();
  const view = render(<EntitySelect options={state.options} value="one" onChange={change} />);
  view.rerender(<EntitySelect options={state.options} value="one" onChange={change} />);
  act(() => trigger().focus());
  fireEvent.keyDown(trigger(), { key: "s" });
  expect(change).not.toHaveBeenCalled();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByTestId("entity-select-listbox")).toBeNull();
});

it.each(["edit and create", "create only", "no rows"])("keeps no-match Enter in search with %s", async (setup) => {
  const change = vi.fn();
  const edit = vi.fn();
  const create = vi.fn();
  const blur = vi.fn();
  render(<EntitySelect
    options={state.options}
    value={setup === "edit and create" ? "one" : undefined}
    onChange={change}
    onEditSelected={edit}
    onCreateNew={setup === "no rows" ? undefined : create}
    onBlur={blur}
    allowCreate
    alwaysShowSearch
  />);
  open();
  const search = screen.getByTestId("entity-select-search");
  await waitFor(() => expect(document.activeElement).toBe(search));
  fireEvent.change(search, { target: { value: "zzz" } });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByTestId("entity-select-listbox")).toBeTruthy();
  expect(document.activeElement).toBe(search);
  for (const callback of [change, edit, create, blur]) expect(callback).not.toHaveBeenCalled();
  for (const testId of ["entity-select-edit", "entity-select-create"]) {
    const action = screen.queryByTestId(testId);
    if (action?.hasAttribute("data-highlighted")) {
      expect(action.className).not.toContain("data-[highlighted]:bg-");
    }
  }
});

it.each([false, true])("preserves recovery-link Enter activation (None row: %s)", async (withNone) => {
  const change = vi.fn();
  const blur = vi.fn();
  render(<EntitySelect
    options={[]}
    onChange={change}
    onBlur={blur}
    noneOption={withNone ? { label: "None" } : undefined}
    emptyHint={{ message: "Create a bin first", href: "/storage-locations" }}
  />);
  act(() => trigger().focus());
  key("ArrowDown");
  fireEvent.keyDown(trigger(), { key: "Tab" });
  const link = screen.getByRole("link");
  await waitFor(() => expect(document.activeElement).toBe(link));
  // jsdom does not navigate on Enter; an uncanceled event preserves native activation.
  expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(true);
  expect(change).not.toHaveBeenCalled();
  expect(blur).not.toHaveBeenCalled();
});
