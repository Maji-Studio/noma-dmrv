// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";

afterEach(cleanup);
it("isolates a real portalled form submit from its entry form", () => {
  const outer = vi.fn(); const inner = vi.fn();
  render(<form onSubmit={outer}><QuickAddDialogShell isOpen onClose={vi.fn()} title="Edit supplier">
    <form onSubmit={(event) => { event.preventDefault(); inner(); }}><button type="submit">Save</button></form>
  </QuickAddDialogShell></form>);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(inner).toHaveBeenCalledOnce(); expect(outer).not.toHaveBeenCalled();
});
it("Escape and close dismiss only the top of three stacked dialogs", async () => {
  const parentClosed = vi.fn();
  function Stack() {
    const [top, setTop] = useState(false);
    return <QuickAddDialogShell isOpen onClose={parentClosed} title="Entry">
      <QuickAddDialogShell isOpen onClose={parentClosed} title="Bin">
        <button onClick={() => setTop(true)}>Edit formulation</button>
        <QuickAddDialogShell isOpen={top} onClose={() => setTop(false)} title="Formulation"><input aria-label="Name" /></QuickAddDialogShell>
      </QuickAddDialogShell>
    </QuickAddDialogShell>;
  }
  render(<Stack />);
  fireEvent.click(screen.getByRole("button", { name: "Edit formulation" }));
  const top = screen.getByRole("dialog", { name: "Formulation" });
  fireEvent.keyDown(within(top).getByRole("textbox"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Formulation" })).toBeNull());
  expect(parentClosed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Edit formulation" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Formulation" })).getByRole("button", { name: /close/i }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Formulation" })).toBeNull());
  expect(parentClosed).not.toHaveBeenCalled();
});
