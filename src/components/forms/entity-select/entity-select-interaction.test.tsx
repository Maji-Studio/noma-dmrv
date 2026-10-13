// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntitySelect } from "./entity-select";
import { FormEntitySelect } from "./form-entity-select";
import { useForm } from "react-hook-form";
import { Modal } from "@/components/ui/modal/modal";
import type { EntityOption } from "./types";
import { ENTITY_SEARCH_LIMIT } from "@/config/forms";

const state = vi.hoisted(() => ({ permissionChecks: 0, dialogMounts: [] as string[], listEnabled: [] as boolean[], detailIds: [] as (string | undefined)[], options: [] as EntityOption[], loading: false, canManage: false, error: null as Error | null }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: ({ search, enabled }: { search: string; enabled: boolean }) => {
    state.listEnabled.push(enabled);
    return {
      data: state.options.filter((option) => option.name.toLowerCase().includes(search.toLowerCase())),
      isLoading: state.loading,
      error: state.error,
    };
  },
  useEntityById: (_type: string, id: string | undefined) => {
    state.detailIds.push(id);
    return { data: { id: "one", code: "1", name: "North bin" }, isPending: false };
  },
}));
vi.mock("./driver-quick-add-dialog", () => ({ DriverQuickAddDialog: () => { state.dialogMounts.push("Driver"); return null; } }));
vi.mock("./operator-quick-add-dialog", () => ({ OperatorQuickAddDialog: () => { state.dialogMounts.push("Operator"); return null; } }));
vi.mock("./vehicle-quick-add-dialog", () => ({ VehicleQuickAddDialog: () => { state.dialogMounts.push("Vehicle"); return null; } }));
vi.mock("./feedstock-type-quick-add-dialog", () => ({ FeedstockTypeQuickAddDialog: () => { state.dialogMounts.push("FeedstockType"); return null; } }));
vi.mock("./formulation-quick-add-dialog", () => ({ FormulationQuickAddDialog: () => { state.dialogMounts.push("Formulation"); return null; } }));
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

function LockedFormPicker() {
  const { control } = useForm({ defaultValues: { binId: "one" } });
  return <FormEntitySelect control={control} name="binId" label="Storage bin" entityType="storageLocation" selectionLocked onEditSelected={vi.fn()} />;
}

describe("EntitySelect menu interactions", () => {
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

  it("walks none, options, edit, create in order and activates Edit", () => {
    const edit = vi.fn(); const change = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" onChange={change} onEditSelected={edit} noneOption={{ label: "None" }} allowCreate onCreateNew={vi.fn()} />);
    key("ArrowDown");
    expect(activeTestId()).toBe("entity-select-none");
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
    rerender(<EntitySelect options={[]} value={value} selectedLabel={selectedLabel} placeholder={placeholder} onChange={change} error={new Error("Registry unavailable")} />);
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
    rerender(<EntitySelect options={localOptions} onChange={vi.fn()} error={new Error("Registry unavailable")} />);
    expect(screen.getByText("Error loading options")).toBeTruthy();
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
