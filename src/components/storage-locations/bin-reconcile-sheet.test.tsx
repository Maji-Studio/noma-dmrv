import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";

vi.mock("@/components/ui/slide-over-panel", () => {
  const Root = ({
    children,
    open,
  }: {
    children: ReactNode;
    open?: boolean;
  }) => (open ? <aside>{children}</aside> : null);
  const Content = ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  );
  const Header = ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  );
  const Title = ({ children }: { children: ReactNode }) => <h2>{children}</h2>;
  const Description = ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  );
  const Body = ({ children }: { children: ReactNode }) => <div>{children}</div>;

  return {
    SlideOverPanel: { Root, Content, Header, Title, Description, Body },
  };
});

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

vi.mock("@/hooks/use-bin-movements", () => ({
  RecordLossConflictError: class RecordLossConflictError extends Error {},
  RecordLossFieldError: class RecordLossFieldError extends Error {},
  useRecordLoss: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { BinReconcileSheet } from "./bin-reconcile-sheet";

const storageLocation: StorageLocationWithFacility = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  code: "FB-001",
  name: "North hopper",
  type: "feedstock_bin",
  capacityKg: null,
  storageMethod: null,
  storageDescription: null,
  supplierReferenceId: null,
  feedstockTypeId: null,
  formulationId: null,
  facilityId: "00000000-0000-4000-8000-000000000003",
  archivedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  facilityCode: "FAC-1",
  facilityName: "Moshi",
  feedstockTypeName: null,
  formulationName: null,
  feedstockInventory: {
    batchCount: 1,
    pendingBatchCount: 0,
    feedstockTypes: ["Wood chips"],
    currentWetMassKg: 150,
    estimatedDryMassKg: 125,
    pendingWetMassKg: 0,
    estimatedMoisturePercent: 16.7,
  },
  biocharInventory: {
    productionRunCount: 0,
    currentMassKg: 75,
    allocatedToProductsKg: 0,
    downstreamFormulations: [],
  },
  productInventory: {
    batchCount: 0,
    currentMassKg: 25,
    biocharEquivalentKg: 0,
    formulationNames: [],
    appliedApplicationCount: 0,
    appliedDryMassKg: 0,
    lastAppliedAt: null,
  },
  lastActivity: null,
};

describe("BinReconcileSheet", () => {
  it.each([
    {
      type: "feedstock_bin",
      expectedStockLabel: "Current wet stock",
      expectedStock: "150 kg",
      expectedLossLabel: "Wet mass lost (kg)",
      showsMoisture: true,
    },
  ] as const)(
    "opens a $type directly on the loss form without stock-take controls",
    ({
      type,
      expectedStockLabel,
      expectedStock,
      expectedLossLabel,
      showsMoisture,
    }) => {
      const markup = renderToStaticMarkup(
        <BinReconcileSheet
          open
          onOpenChange={() => undefined}
          storageLocation={{ ...storageLocation, type }}
        />,
      );

      expect(markup).toContain("Reconcile FB-001");
      expect(markup).toContain("North hopper");
      expect(markup).toContain(expectedStockLabel);
      expect(markup).toContain(expectedStock);
      if (showsMoisture) {
        expect(markup).toContain("Current estimated moisture");
      } else {
        expect(markup).not.toContain("Current estimated moisture");
      }
      expect(markup).toContain(expectedLossLabel);
      expect(markup).toContain('id="loss-amount"');
      expect(markup).toContain('id="loss-reason"');
      expect(markup).toContain("Record loss");
      expect(markup).toContain("Cancel");

      expect(markup).not.toContain("Reconciliation type");
      expect(markup).not.toContain("Record stock-take");
      expect(markup).not.toContain("Counted stock");
      expect(markup).not.toContain('id="moisture-percent"');
    },
  );
});

vi.mock("@/hooks/use-output-stock", () => ({
  useOutputStockPreview: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }),
  usePostOutputStock: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

describe("Output-bin reconciliation", () => {
  it.each(["biochar_bin", "product_bin"] as const)("offers count and loss for %s", (type) => {
    const markup = renderToStaticMarkup(<BinReconcileSheet open onOpenChange={() => undefined} storageLocation={{ ...storageLocation, type }} />);
    expect(markup).toContain("Counted wet mass (kg)");
    expect(markup).toContain("Moisture (%)");
    expect(markup).toContain("Record loss");
    expect(markup).toContain("Reconcile stock");
    expect(markup).toContain("A zero count does not need moisture.");
    expect(markup).not.toContain("Current derived stock");
  });
});
