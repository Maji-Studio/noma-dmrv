import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { RowActionsMenu, type RowActionsMenuProps } from "@/components/ui";
import { CreditBatchCard } from "./credit-batch-card";

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
      certifierLabel: null,
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
});
