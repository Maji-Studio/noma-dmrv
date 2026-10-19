// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivedFormulationNotice } from "./formulation-notices";

afterEach(cleanup);

describe("formulation notices", () => {
  it("explains an archived formulation and restores it", () => {
    const onRestore = vi.fn();
    render(<ArchivedFormulationNotice onRestore={onRestore} isPending={false} />);
    expect(screen.getByText("This formulation is archived. Pickers hide it and new products, orders and bins cannot use it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledOnce();
  });
});
