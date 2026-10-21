import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FacilityWithRelations } from "@/data-access/facilities";
import { RowActionsMenu, type RowActionsMenuProps } from "@/components/ui";
import { FacilityCard } from "./facility-card";

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

const facility = {
  id: "facility-1",
  code: "FAC-001",
  name: "North Facility",
  country: "Tanzania",
  location: "Dodoma",
  address: "1 Test Road",
  archivedAt: null,
  reactorCount: 2,
  storageLocationCount: 3,
  inventorySummary: { feedstockWetKg: 100 },
} as FacilityWithRelations;

describe("FacilityCard", () => {
  it("opens detail from the card body and exposes neutral edit/archive menu actions", () => {
    const onView = vi.fn();
    const onEdit = vi.fn();
    const onArchive = vi.fn();
    const view = FacilityCard({
      facility,
      onView,
      onEdit,
      onArchive,
      onRestore: vi.fn(),
    });
    const menu = findRowActions(view);

    view.props.onClick();
    menu?.props.actions[0]?.onSelect?.();
    menu?.props.actions[1]?.onSelect?.();

    expect(onView).toHaveBeenCalledWith(facility);
    expect(onEdit).toHaveBeenCalledWith(facility);
    expect(onArchive).toHaveBeenCalledWith(facility.id);
    expect(menu?.props.actions.map(({ label, destructive }) => [label, destructive])).toEqual([
      ["Edit", undefined],
      ["Archive", undefined],
    ]);
  });

  it("uses a neutral restore action for archived facilities", () => {
    const archivedFacility = { ...facility, archivedAt: new Date() };
    const onRestore = vi.fn();
    const view = FacilityCard({
      facility: archivedFacility,
      onView: vi.fn(),
      onEdit: vi.fn(),
      onArchive: vi.fn(),
      onRestore,
    });
    const action = findRowActions(view)?.props.actions[0];

    action?.onSelect?.();

    expect(action?.label).toBe("Restore");
    expect(action?.destructive).toBeUndefined();
    expect(onRestore).toHaveBeenCalledWith(facility.id);
  });
});
