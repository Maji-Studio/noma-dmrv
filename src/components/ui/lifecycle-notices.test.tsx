// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { IN_USE_REASON } from "@/lib/delete-refusal";
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

  it("recognizes the structured reason regardless of the message", () => {
    const message = "This record is still used.";
    const error = new ActionError({ error: message, code: "conflict", issues: [
      { path: ["name"], code: "conflict", message: "Name is taken." },
      { path: ["supplierId"], code: "conflict", message, meta: { reason: IN_USE_REASON } },
    ] });
    expect(isInUseDeleteRefusal(error)).toBe(true);
  });

  it("rejects ordinary conflicts and wording without the structured reason", () => {
    const message = "Customer was not deleted because orders still use it.";
    expect(isInUseDeleteRefusal(new ActionError({ error: "Name is taken.", code: "conflict", issues: [
      { path: ["name"], code: "conflict", message: "Name is taken." },
    ] }))).toBe(false);
    expect(isInUseDeleteRefusal(new ActionError({ error: message, code: "conflict" }))).toBe(false);
    expect(isInUseDeleteRefusal(new ActionError({ error: message, issues: [
      { path: [], code: "conflict", message, meta: { reason: "other" } },
    ] }))).toBe(false);
    expect(isInUseDeleteRefusal(new Error(message))).toBe(false);
    expect(isInUseDeleteRefusal(message)).toBe(false);
    expect(isInUseDeleteRefusal(null)).toBe(false);
  });
});
