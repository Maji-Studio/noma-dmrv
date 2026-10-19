// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityOption } from "./types";
import { EntitySelect } from "./entity-select";

const state = vi.hoisted(() => ({ options: [] as EntityOption[], refreshOnReturn: vi.fn() }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: state.options, isLoading: false, error: null }),
  useEntityById: () => ({ data: undefined, isPending: false }),
}));
vi.mock("@/hooks/use-refresh-entity-options-on-return", () => ({
  useRefreshEntityOptionsOnReturn: () => state.refreshOnReturn,
}));
vi.mock("./driver-quick-add-dialog", () => ({ DriverQuickAddDialog: () => null }));
vi.mock("./operator-quick-add-dialog", () => ({ OperatorQuickAddDialog: () => null }));
vi.mock("./vehicle-quick-add-dialog", () => ({ VehicleQuickAddDialog: () => null }));
vi.mock("./feedstock-type-quick-add-dialog", () => ({ FeedstockTypeQuickAddDialog: () => null }));
vi.mock("./formulation-quick-add-dialog", () => ({ FormulationQuickAddDialog: () => null }));
vi.mock("@/hooks/use-entity-edit-record", () => ({
  isEditableEntityType: () => true,
  useCanManageFeedstockTypes: () => false,
}));

const CREATE_HREF = "/reactors?facility=f1&create=true";
let openWindow: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.options = [];
  state.refreshOnReturn.mockClear();
  openWindow = vi.fn();
  window.open = openWindow as unknown as typeof window.open;
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

const createRow = () => screen.getByTestId("entity-select-create");
const openPicker = () => fireEvent.click(screen.getByTestId("entity-select-trigger"));

describe("EntitySelect create page link", () => {
  it("names the empty list and opens the create page in a new tab", () => {
    render(<EntitySelect entityType="reactor" onChange={vi.fn()} allowCreate createHref={CREATE_HREF} emptyHint={{ message: "This facility has no reactors yet." }} />);
    openPicker();

    expect(screen.getByText("This facility has no reactors yet.")).toBeTruthy();
    expect(createRow().textContent).toBe("Add new reactor (opens in a new tab)");
    fireEvent.click(createRow());

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(CREATE_HREF, "_blank", "noopener,noreferrer");
    expect(state.refreshOnReturn).toHaveBeenCalledOnce();
  });

  it("keeps the link below existing reactors", () => {
    state.options = [{ id: "r1", code: "R1", name: "Mafinga reactor 1" }];
    const change = vi.fn();
    render(<EntitySelect entityType="reactor" value="r1" onChange={change} allowCreate createHref={CREATE_HREF} />);
    openPicker();

    const rows = Array.from(screen.getByTestId("entity-select-listbox").querySelectorAll("[data-testid]"), (row) => row.getAttribute("data-testid"));
    expect(rows).toEqual(["entity-option-r1", "entity-select-create"]);
    fireEvent.keyDown(screen.getByTestId("entity-select-trigger"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByTestId("entity-select-trigger"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByTestId("entity-select-trigger"), { key: "Enter" });
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(CREATE_HREF, "_blank", "noopener,noreferrer");
    expect(change).not.toHaveBeenCalled();
  });

  it("lets a quick-add callback win over the create page", () => {
    const quickAdd = vi.fn();
    render(<EntitySelect entityType="reactor" onChange={vi.fn()} allowCreate createHref={CREATE_HREF} onCreateNew={quickAdd} />);
    openPicker();

    expect(createRow().textContent).toBe("Add new reactor");
    fireEvent.click(createRow());
    expect(quickAdd).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("reloads the options after the operator follows an empty-list recovery link", () => {
    render(<EntitySelect entityType="order" onChange={vi.fn()} emptyHint={{ message: "Record the customer order first.", href: "/orders", linkLabel: "Open orders" }} />);
    openPicker();

    fireEvent.click(screen.getByText("Open orders"));
    expect(state.refreshOnReturn).toHaveBeenCalledOnce();
  });

  it("also reloads after a middle click opens the recovery link", () => {
    render(<EntitySelect entityType="order" onChange={vi.fn()} emptyHint={{ message: "Record the customer order first.", href: "/orders", linkLabel: "Open orders" }} />);
    openPicker();

    fireEvent(screen.getByText("Open orders"), new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(state.refreshOnReturn).not.toHaveBeenCalled();
    fireEvent(screen.getByText("Open orders"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(state.refreshOnReturn).toHaveBeenCalledOnce();
  });
});
