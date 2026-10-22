// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivedRecordNotice } from "./lifecycle-notices";

afterEach(cleanup);

describe("lifecycle notices", () => {
  it("shows the archived banner with Restore", () => {
    const onRestore = vi.fn();
    render(<ArchivedRecordNotice onRestore={onRestore} isPending={false}>This supplier is archived.</ArchivedRecordNotice>);
    expect(screen.getByText("This supplier is archived.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledOnce();
  });
});
