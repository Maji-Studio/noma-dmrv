// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArchivedFormulationNotice,
  FormulationDeleteConflictNotice,
  isFormulationInUseRefusal,
} from "./formulation-notices";

afterEach(cleanup);

describe("formulation notices", () => {
  it("offers Archive instead when a delete is refused because records use the formulation", () => {
    const onArchive = vi.fn();
    render(<FormulationDeleteConflictNotice code="BCF-0003" onArchive={onArchive} isPending={false} />);
    expect(screen.getByText("BCF-0003 is in use and cannot be deleted.")).toBeTruthy();
    expect(screen.getByText("Archive it instead. Existing records keep it, while pickers hide it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it("explains an archived formulation and restores it", () => {
    const onRestore = vi.fn();
    render(<ArchivedFormulationNotice onRestore={onRestore} isPending={false} />);
    expect(screen.getByText("This formulation is archived. Pickers hide it and new products, orders and bins cannot use it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it("recognizes the in-use delete refusals and nothing else", () => {
    expect(isFormulationInUseRefusal("Formulation was not deleted because biochar products use it. Keep this formulation.")).toBe(true);
    expect(isFormulationInUseRefusal("Formulation was not deleted because orders use it. Keep this formulation.")).toBe(true);
    expect(isFormulationInUseRefusal("Formulation BCF-0003 was not deleted. It changed since the list loaded. Review it before deleting.")).toBe(false);
  });
});
