// @vitest-environment jsdom
// #1177: a record can lock (the lock read answers In use or Sent, or a refetch
// fails closed) while its picker menu or quick-add dialog is still open. The
// picker must close and never hand the locked form a new value.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntitySelect } from "./entity-select";
import type { EntityOption } from "./types";

interface TestQuickAddDialogProps { isOpen: boolean; onClose: () => void; onSuccess: (entity: EntityOption) => void }

const created: EntityOption = { id: "new-driver", code: "D-NEW", name: "New driver" };
// The real dialogs await the server action with the onSuccess they had at
// submit time, so the save must resolve after the lock to model that closure.
const server = vi.hoisted(() => ({ respond: () => {} }));
const options: EntityOption[] = [{ id: "one", code: "1", name: "North bin" }, { id: "two", code: "2", name: "South bin" }];

// Every render's onValueChange, so a test can replay an older render's handler.
const combobox = vi.hoisted(() => ({ handlers: [] as ((row: unknown, details: unknown) => void)[] }));
vi.mock("@base-ui/react/combobox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@base-ui/react/combobox")>();
  const Root = ((props: { onValueChange: (row: unknown, details: unknown) => void }) => {
    combobox.handlers.push(props.onValueChange);
    return <actual.Combobox.Root {...(props as object)} />;
  }) as unknown as typeof actual.Combobox.Root;
  return { ...actual, Combobox: { ...actual.Combobox, Root } };
});
vi.mock("@/hooks/use-refresh-entity-options-on-return", () => ({ useRefreshEntityOptionsOnReturn: () => () => {} }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: [], isLoading: false, error: null }),
  useEntityById: () => ({ data: undefined, isPending: false }),
}));
vi.mock("@/hooks/use-entity-edit-record", () => ({
  isEditableEntityType: () => true,
  useCanManageFeedstockTypes: () => false,
}));
vi.mock("./driver-quick-add-dialog", () => ({
  DriverQuickAddDialog: ({ isOpen, onSuccess }: TestQuickAddDialogProps) => isOpen
    ? <button type="button" onClick={async () => {
      await new Promise<void>((resolve) => { server.respond = resolve; });
      onSuccess(created);
    }}>Save driver</button>
    : null,
}));
vi.mock("./operator-quick-add-dialog", () => ({ OperatorQuickAddDialog: () => null }));
vi.mock("./vehicle-quick-add-dialog", () => ({ VehicleQuickAddDialog: () => null }));
vi.mock("./feedstock-type-quick-add-dialog", () => ({ FeedstockTypeQuickAddDialog: () => null }));
vi.mock("./formulation-quick-add-dialog", () => ({ FormulationQuickAddDialog: () => null }));

beforeEach(() => {
  combobox.handlers = [];
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

const trigger = () => screen.getByTestId("entity-select-trigger");
const listbox = () => screen.queryByTestId("entity-select-listbox");

describe.each([
  { lock: "disabled", props: { disabled: true } },
  { lock: "selectionLocked", props: { selectionLocked: true } },
])("EntitySelect when the record locks while it is open ($lock)", ({ props }) => {
  it("closes the open menu and stays closed when the lock lifts", () => {
    const change = vi.fn();
    const view = render(<EntitySelect options={options} value="" onChange={change} />);
    fireEvent.click(trigger());
    expect(listbox()).not.toBeNull();

    view.rerender(<EntitySelect options={options} value="" onChange={change} {...props} />);
    expect(listbox()).toBeNull();

    view.rerender(<EntitySelect options={options} value="" onChange={change} />);
    expect(listbox()).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it("does not pick a record whose quick-add save finishes after the lock", async () => {
    const change = vi.fn();
    const view = render(<EntitySelect entityType="driver" value="" onChange={change} allowCreate />);
    fireEvent.click(trigger());
    await act(async () => { fireEvent.click(screen.getByTestId("entity-select-create")); });

    fireEvent.click(screen.getByRole("button", { name: "Save driver" }));

    view.rerender(<EntitySelect entityType="driver" value="" onChange={change} allowCreate {...props} />);
    await act(async () => { server.respond(); });

    expect(change).not.toHaveBeenCalled();
  });
});

it("keeps focus on a locked field that still offers Edit when the lock closes its menu", () => {
  const picker = (locked: boolean) => (
    <EntitySelect options={options} value="one" onChange={vi.fn()} onEditSelected={vi.fn()} selectionLocked={locked} alwaysShowSearch />
  );
  const view = render(picker(false));
  fireEvent.click(trigger());
  const search = screen.getByTestId("entity-select-search");
  search.focus();
  expect(document.activeElement).toBe(search);

  view.rerender(picker(true));

  expect(listbox()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it("refuses an Edit activation from before the field became disabled", () => {
  const edit = vi.fn();
  const picker = (disabled: boolean) => (
    <EntitySelect options={options} value="one" onChange={vi.fn()} onEditSelected={edit} selectionLocked disabled={disabled} />
  );
  const view = render(picker(false));
  fireEvent.click(trigger());
  const staleHandler = combobox.handlers.at(-1)!;

  view.rerender(picker(true));
  act(() => {
    staleHandler({ id: "edit", kind: "edit" }, { reason: "item-press", event: new MouseEvent("click"), cancel: () => {} });
  });

  expect(edit).not.toHaveBeenCalled();
});
