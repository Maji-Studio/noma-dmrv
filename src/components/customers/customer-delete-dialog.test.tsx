// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerDeleteDialog } from "./customer-delete-dialog";

afterEach(cleanup);

const baseProps = {
  customerCode: "E2E-CUST-1",
  changedMessage: null,
  errorMessage: undefined,
  isPending: false,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

function deleteButton() {
  return screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
}

describe("CustomerDeleteDialog", () => {
  it("holds Delete while the orders load", () => {
    render(<CustomerDeleteDialog {...baseProps} cascade={undefined} isLoading />);
    expect(screen.getByText("Checking which orders go with this customer...")).toBeTruthy();
    expect(deleteButton().disabled).toBe(true);
  });

  it("names a single order without deliveries", () => {
    render(<CustomerDeleteDialog {...baseProps} cascade={{ orders: [{ id: "o1", code: "E2E-OR-1" }], cascadeFingerprint: "v1:a" }} isLoading={false} />);
    expect(screen.getByText("This order has no deliveries and is deleted too:")).toBeTruthy();
    expect(screen.getByText("E2E-OR-1")).toBeTruthy();
    expect(deleteButton().disabled).toBe(false);
  });

  it("lists five codes and counts the rest", () => {
    const orders = Array.from({ length: 6 }, (_, index) => ({ id: `o${index}`, code: `E2E-OR-${index + 1}` }));
    render(<CustomerDeleteDialog {...baseProps} cascade={{ orders, cascadeFingerprint: "v1:b" }} isLoading={false} />);
    expect(screen.getByText("These 6 orders have no deliveries and are deleted too:")).toBeTruthy();
    expect(screen.getByText("E2E-OR-5")).toBeTruthy();
    expect(screen.queryByText("E2E-OR-6")).toBeNull();
    expect(screen.getByText("and 1 more")).toBeTruthy();
  });

  it("says when no order goes with the customer", () => {
    render(<CustomerDeleteDialog {...baseProps} cascade={{ orders: [], cascadeFingerprint: "v1:c" }} isLoading={false} />);
    expect(screen.getByText("No orders are deleted with this customer.")).toBeTruthy();
  });

  it("shows why the list changed and confirms only when asked again", () => {
    const onConfirm = vi.fn();
    render(<CustomerDeleteDialog {...baseProps} onConfirm={onConfirm} changedMessage="The orders deleted with this customer changed. Review the list and delete again." cascade={{ orders: [{ id: "o1", code: "E2E-OR-1" }], cascadeFingerprint: "v1:d" }} isLoading={false} />);
    expect(screen.getByText("The orders deleted with this customer changed. Review the list and delete again.")).toBeTruthy();
    fireEvent.click(deleteButton());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
