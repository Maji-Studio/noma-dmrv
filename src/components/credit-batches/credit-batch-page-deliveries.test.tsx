// @vitest-environment jsdom
/** Each delivery row opens its application, and the Removal link stays a separate sibling. */
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import { CreditBatchPageProvider, type CreditBatchPageContextValue } from "./credit-batch-page-context";
import { CreditBatchRemovalsTab } from "./credit-batch-page-removals";

vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));

const BATCH = { id: "batch-1", facilityId: "facility-1" };

function slice(applicationId: string, applicationCode: string, removalId: string | null) {
  return {
    applicationId,
    applicationCode,
    applicationDate: "2026-08-10",
    deliveryCode: "DL-26-001",
    destinationLabel: "DIS/123",
    removalId,
    dryKg: 1000,
  };
}

function mount() {
  const model = {
    slices: [slice("app-1", "AP-26-001", "rem-1"), slice("app-2", "AP-26-002", null)],
    removals: [{ id: "rem-1", code: "RM-26-001", phase: "draft", dryKg: 1000, status: { value: "draft", label: "Draft" } }],
    mass: { appliedDryKg: 2000 },
    milestones: { ghgStatements: [] },
  } as unknown as CreditBatchPageModel;
  render(
    <CreditBatchPageProvider value={{ batch: BATCH, pageModel: model } as unknown as CreditBatchPageContextValue}>
      <CreditBatchRemovalsTab />
    </CreditBatchPageProvider>,
  );
}

afterEach(cleanup);

describe("delivery list", () => {
  it("links each row's label block to its application and keeps the Removal link", () => {
    mount();
    const list = screen.getByRole("heading", { name: /Applied biochar by delivery/ }).closest("section") ?? document.body;
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const first = within(rows[0]).getByRole("link", { name: /DL-26-001 to DIS\/123/ });
    expect(first.getAttribute("href")).toBe("/applications?facility=facility-1&application=app-1");
    expect(first.textContent).toContain("AP-26-001, applied Aug 10, 2026");
    expect(within(rows[0]).getByRole("link", { name: /RM-26-001/ })).toBeTruthy();
    expect(within(rows[0]).getAllByRole("link")).toHaveLength(2);
    const second = within(rows[1]).getByRole("link", { name: /AP-26-002/ });
    expect(second.getAttribute("href")).toContain("app-2");
    expect(within(rows[1]).getAllByRole("link")).toHaveLength(1);
  });
});
