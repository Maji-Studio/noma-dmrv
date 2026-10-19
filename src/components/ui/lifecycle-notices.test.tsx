// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivedRecordNotice, isInUseDeleteRefusal } from "./lifecycle-notices";

afterEach(cleanup);

describe("lifecycle notices", () => {
  it("shows the archived banner with Restore", () => {
    const onRestore = vi.fn();
    render(<ArchivedRecordNotice onRestore={onRestore} isPending={false}>This supplier is archived.</ArchivedRecordNotice>);
    expect(screen.getByText("This supplier is archived.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it("recognizes the in-use delete refusals and nothing else", () => {
    expect(isInUseDeleteRefusal("Supplier was not deleted because feedstock intakes still use it. Keep this supplier.")).toBe(true);
    expect(isInUseDeleteRefusal("Customer was not deleted because orders still use it.")).toBe(true);
    expect(isInUseDeleteRefusal("Supplier SUP-0001 was not deleted. It changed since the list loaded. Review it before deleting.")).toBe(false);
  });
});
