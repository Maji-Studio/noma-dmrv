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

  it("does not pick the highlighted option on Enter", () => {
    const change = vi.fn();
    const view = render(<EntitySelect options={options} value="" onChange={change} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });

    view.rerender(<EntitySelect options={options} value="" onChange={change} {...props} />);
    fireEvent.keyDown(trigger(), { key: "Enter" });

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
