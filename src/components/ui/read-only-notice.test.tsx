// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SheetReadOnly } from "@/lib/linked-record-read-only";

vi.mock("@/components/ui/notice", () => ({
  Notice: ({ children, action }: { children: ReactNode; action?: ReactNode }) => <div>{children}{action}</div>,
}));

import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { ReadOnlyNotice } from "./read-only-notice";

afterEach(cleanup);

describe("ReadOnlyNotice", () => {
  it("links the archived facility name and keeps the sentence exact", () => {
    const readOnly: SheetReadOnly = {
      tone: "info",
      message: "Mafinga is archived, so this production run is read-only.",
      facility: { name: "Mafinga", href: "/facilities?archivedFacility=fac-1" },
    };
    const { container } = render(<ReadOnlyNotice readOnly={readOnly} />);
    const link = screen.getByRole("link", { name: "Mafinga" });
    expect(link.getAttribute("href")).toBe("/facilities?archivedFacility=fac-1");
    // A one-word name in running text still gets a 44px tap target on phones.
    for (const token of INLINE_HIT_AREA.split(" ")) expect(link.classList.contains(token)).toBe(true);
    expect(container.textContent).toBe(readOnly.message);
  });

  it("renders the warning as plain text without a link", () => {
    const readOnly: SheetReadOnly = {
      tone: "warning",
      message: "This order's facility could not be checked, so it is read-only.",
      retry: { run: () => undefined, running: false },
    };
    render(<ReadOnlyNotice readOnly={readOnly} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(readOnly.message)).toBeTruthy();
  });
});
