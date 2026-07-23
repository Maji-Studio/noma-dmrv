import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Modal, type ModalProps } from "@/components/ui";
import {
  GhgStatementCreateDialog,
  PeriodWindow,
} from "./ghg-statement-create-dialog";

describe("GhgStatementCreateDialog", () => {
  it("uses protected, accessible shared Modal chrome", () => {
    const view = GhgStatementCreateDialog({
      facilityId: "facility-1",
      isProduction: false,
      open: true,
      onClose: vi.fn(),
    });

    expect(isValidElement(view)).toBe(true);
    const modal = view as ReactElement<ModalProps>;
    expect(modal.type).toBe(Modal);
    expect(modal.props).toMatchObject({
      isOpen: true,
      ariaLabelledBy: "ghg-statement-create-title",
      ariaDescribedBy: "ghg-statement-create-description",
      width: "xl",
      dismissOnClickOutside: false,
    });
  });
});

describe("PeriodWindow", () => {
  it("shows Isometric-owned first start and the chosen end", () => {
    const html = renderToStaticMarkup(
      <PeriodWindow derivedStart={null} endOn="2026-07-31" />,
    );

    expect(html).toContain("Start");
    expect(html).toContain("Set by Isometric");
    expect(html).toContain("End");
    expect(html).toContain("Jul 31, 2026");
  });

  it("shows the derived start for later statements", () => {
    const html = renderToStaticMarkup(
      <PeriodWindow
        derivedStart="2026-07-01"
        endOn="2026-07-31"
      />,
    );

    expect(html).toContain("Start");
    expect(html).toContain("Jul 1, 2026");
    expect(html).toContain("End");
    expect(html).toContain("Jul 31, 2026");
  });
});
