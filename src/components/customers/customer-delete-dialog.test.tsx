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
    render(<CustomerDeleteDialog {...baseProps} cascade={{ orders: [{ id: "o1", code: "E2E-OR-1", facilityId: "f1" }], cascadeFingerprint: "v1:a" }} isLoading={false} />);
    expect(screen.getByText("This order is deleted too")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open order E2E-OR-1" });
    expect(link.getAttribute("href")).toBe("/orders?facility=f1&order=o1");
    expect(deleteButton().disabled).toBe(false);
    expect(screen.getByText("Delete customer E2E-CUST-1 and its locations?")).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    // Primary first, Cancel after.
    const labels = screen.getAllByRole("button").map((b) => b.textContent).filter((t) => t === "Delete" || t === "Cancel");
    expect(labels).toEqual(["Delete", "Cancel"]);
  });

  it("lists five codes and counts the rest", () => {
    const orders = Array.from({ length: 6 }, (_, index) => ({ id: `o${index}`, code: `E2E-OR-${index + 1}`, facilityId: "f1" }));
    render(<CustomerDeleteDialog {...baseProps} cascade={{ orders, cascadeFingerprint: "v1:b" }} isLoading={false} />);
    expect(screen.getByText("These 6 orders are deleted too")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open order E2E-OR-5" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open order E2E-OR-6" })).toBeNull();
    expect(screen.getByText("and 1 more")).toBeTruthy();
  });

  it("says when no order goes with the customer", () => {
    render(<CustomerDeleteDialog {...baseProps} cascade={{ orders: [], cascadeFingerprint: "v1:c" }} isLoading={false} />);
    expect(screen.getByText("No orders are deleted with this customer.")).toBeTruthy();
  });

  it("shows why the list changed and confirms only when asked again", () => {
    const onConfirm = vi.fn();
    render(<CustomerDeleteDialog {...baseProps} onConfirm={onConfirm} changedMessage="The orders deleted with this customer changed. Review the list and delete again." cascade={{ orders: [{ id: "o1", code: "E2E-OR-1", facilityId: "f1" }], cascadeFingerprint: "v1:d" }} isLoading={false} />);
    expect(screen.getByText("The orders deleted with this customer changed. Review the list and delete again.")).toBeTruthy();
    fireEvent.click(deleteButton());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
