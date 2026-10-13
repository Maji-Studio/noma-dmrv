// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntitySelect } from "./entity-select";
import { Modal } from "@/components/ui/modal/modal";
import type { EntityOption } from "./types";

const state = vi.hoisted(() => ({ options: [] as EntityOption[], loading: false, error: null as Error | null }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: state.options, isLoading: state.loading, error: state.error }),
  useEntityById: () => ({ data: { id: "one", code: "1", name: "North bin" }, isPending: false }),
}));
vi.mock("./driver-quick-add-dialog", () => ({ DriverQuickAddDialog: () => null }));
vi.mock("./operator-quick-add-dialog", () => ({ OperatorQuickAddDialog: () => null }));
vi.mock("./vehicle-quick-add-dialog", () => ({ VehicleQuickAddDialog: () => null }));
vi.mock("./feedstock-type-quick-add-dialog", () => ({ FeedstockTypeQuickAddDialog: () => null }));
vi.mock("./formulation-quick-add-dialog", () => ({ FormulationQuickAddDialog: () => null }));
const scroll = vi.fn();
let finePointer = true;
beforeEach(() => {
  state.options = [{ id: "one", code: "1", name: "North bin" }, { id: "two", code: "2", name: "South bin" }];
  state.loading = false;
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

describe("EntitySelect menu interactions", () => {
  it.each([{ value: undefined, edit: true }, { value: "one", edit: false }])("requires selection and callback: %s", ({ value, edit }) => {
    render(<EntitySelect entityType="storageLocation" value={value} onChange={vi.fn()} onEditSelected={edit ? vi.fn() : undefined} />);
    open();
    expect(screen.queryByTestId("entity-select-edit")).toBeNull();
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
    render(<EntitySelect entityType="storageLocation" disabled onChange={vi.fn()} onEditSelected={vi.fn()} />);
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

  it("offers only Edit when locked", () => {
    const edit = vi.fn(); const change = vi.fn();
    render(<EntitySelect entityType="storageLocation" value="one" disabled onChange={change} onEditSelected={edit} noneOption={{ label: "None" }} allowCreate onCreateNew={vi.fn()} alwaysShowSearch />);
    open();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByTestId("entity-select-create")).toBeNull();
    expect(screen.queryByTestId("entity-select-search")).toBeNull();
    expect(screen.queryByTestId("entity-select-clear")).toBeNull();
    key("Enter"); expect(edit).toHaveBeenCalledOnce(); expect(change).not.toHaveBeenCalled();
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
    expect(activeTestId()).toBe("entity-select-create");
    expect(scroll.mock.contexts.at(-1)).toBe(screen.getByTestId("entity-select-create"));
  });
});
