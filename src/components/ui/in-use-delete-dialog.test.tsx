// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InUseDeleteDialog } from "./in-use-delete-dialog";

afterEach(cleanup);

describe("InUseDeleteDialog", () => {
  it("names the row, explains the refusal and puts Archive instead before Cancel", () => {
    const onArchive = vi.fn();
    const onClose = vi.fn();
    render(<InUseDeleteDialog label="SUP-0007" onArchive={onArchive} onClose={onClose} />);
    expect(screen.getByText("SUP-0007 is in use")).toBeTruthy();
    expect(screen.getByText("Archive it instead. Existing records keep it, while pickers hide it.")).toBeTruthy();
    const buttons = screen.getAllByRole("button").filter((b) => ["Archive instead", "Cancel"].includes(b.textContent ?? ""));
    expect(buttons.map((b) => b.textContent)).toEqual(["Archive instead", "Cancel"]);
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    expect(onArchive).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows only Close without an archive handler", () => {
    render(<InUseDeleteDialog label="Depot" onClose={vi.fn()}>Custom reason.</InUseDeleteDialog>);
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
    expect(screen.getByText("Custom reason.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });
});
