// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivedCustomerNotice, ArchivedSupplierNotice } from "./party-notices";

afterEach(cleanup);

describe("party notices", () => {
  it.each([
    [ArchivedSupplierNotice, "This supplier is archived. Pickers hide it and new intakes cannot use it."],
    [ArchivedCustomerNotice, "This customer is archived. Pickers hide it and new orders cannot use it. Existing orders keep it."],
  ])("explains what an archived party can no longer do and restores it", (Notice, text) => {
    const onRestore = vi.fn();
    render(<Notice onRestore={onRestore} isPending={false} />);
    expect(screen.getByText(text)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledOnce();
  });
});
