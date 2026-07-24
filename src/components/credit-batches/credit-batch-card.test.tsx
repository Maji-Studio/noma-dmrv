import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { RowActionsMenu, type RowActionsMenuProps } from "@/components/ui";
import { CreditBatchCard } from "./credit-batch-card";
import { CreditBatchLifecycleRail } from "./credit-batch-lifecycle";

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function findRowActions(node: ReactNode): ReactElement<RowActionsMenuProps> | undefined {
  if (!isValidElement<ElementProps>(node)) return undefined;
  if (node.type === RowActionsMenu) {
    return node as unknown as ReactElement<RowActionsMenuProps>;
  }
  const children = node.props.children;
  if (Array.isArray(children)) {
    return children.map(findRowActions).find(Boolean);
  }
  return findRowActions(children);
}

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!isValidElement<ElementProps>(node)) return "";
  const children = node.props.children;
  if (Array.isArray(children)) {
    return children.map(collectText).join("");
  }
  return collectText(children);
}

const creditBatch = {
  id: "batch-1",
  code: "CB-001",
  facilityId: "facility-1",
  status: "draft",
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  facility: { name: "North Facility" },
  productionRunCount: 0,
} as CreditBatchWithRelations;

describe("CreditBatchCard", () => {
  it("keeps card-body detail navigation and marks only delete as destructive", () => {
    const onView = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const view = CreditBatchCard({
      creditBatch,
      onView,
      onEdit,
      onDelete,
    });
    const menu = findRowActions(view);

    view.props.onClick();
    menu?.props.actions[0]?.onSelect?.();
    menu?.props.actions[1]?.onSelect?.();

    expect(onView).toHaveBeenCalledWith(creditBatch);
    expect(onEdit).toHaveBeenCalledWith(creditBatch);
    expect(onDelete).toHaveBeenCalledWith(creditBatch.id);
    expect(menu?.props.actions.map(({ label, destructive }) => [label, destructive])).toEqual([
      ["Edit", undefined],
      ["Delete", true],
    ]);
  });

  it("uses quiet copy when certification progress is loading or unavailable", () => {
    const unavailable = CreditBatchCard({
      creditBatch,
      onView: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    });
    const loading = CreditBatchCard({
      creditBatch,
      isHealthLoading: true,
      onView: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(collectText(unavailable)).toContain(
      "Certification progress unavailable",
    );
    expect(collectText(loading)).toContain("Loading certification progress…");
  });

  it("places readiness beside the open lifecycle state", () => {
    const summary: CreditBatchHealthSummary = {
      state: "incomplete",
      issueCount: 2,
      removalId: null,
      removalStatus: null,
      ghgStatementId: null,
      ghgStatementStatus: null,
    };

    const rail = CreditBatchLifecycleRail({ summary });
    const text = collectText(rail);

    expect(text).toContain("Open2 issues open");
  });
});
