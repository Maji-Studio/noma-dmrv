// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";

afterEach(cleanup);

const renderDialog = (props: Partial<React.ComponentProps<typeof DeleteConfirmDialog>> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <DeleteConfirmDialog isOpen title="Delete thing" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} {...props} />,
  );
  return { onConfirm, onCancel };
};

describe("DeleteConfirmDialog", () => {
  it("shows the label and no spinner when idle", () => {
    renderDialog();
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm.getAttribute("aria-busy")).toBeNull();
    expect(confirm.querySelector(".animate-spin")).toBeNull();
  });

  it("shows the busy spinner while pending and keeps the label, never a text swap", () => {
    renderDialog({ isPending: true, confirmLabel: "Revoke" });
    const confirm = screen.getByRole("button", { name: "Revoke" }) as HTMLButtonElement;
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(confirm.disabled).toBe(true);
    expect(confirm.querySelector(".animate-spin")).not.toBeNull();
    expect(confirm.textContent).toBe("Revoke");
    expect(screen.queryByText(/ing\.\.\.|ing…/)).toBeNull();
  });

  it("disables Cancel and ignores Escape while pending", () => {
    const { onCancel } = renderDialog({ isPending: true });
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("confirms and cancels when idle", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
