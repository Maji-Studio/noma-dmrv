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
    currentDryMassKg: 125,
    pendingDryMassKg: 0,
    estimatedWetMassKg: 150,
    estimatedMoisturePercent: 16.7,
  },
  biocharInventory: {
    productionRunCount: 0,
    currentMassKg: 0,
    allocatedToProductsKg: 0,
    downstreamFormulations: [],
  },
  productInventory: {
    batchCount: 0,
    currentMassKg: 0,
    biocharEquivalentKg: 0,
    formulationNames: [],
    appliedApplicationCount: 0,
    appliedDryMassKg: 0,
    lastAppliedAt: null,
  },
  lastActivity: null,
};

describe("BinReconcileSheet", () => {
  it.each(["feedstock_bin", "biochar_bin", "product_bin"] as const)(
    "opens a %s directly on the loss form without stock-take controls",
    (type) => {
      const markup = renderToStaticMarkup(
        <BinReconcileSheet
          open
          onOpenChange={() => undefined}
          storageLocation={{ ...storageLocation, type }}
        />,
      );

      expect(markup).toContain("Reconcile FB-001");
      expect(markup).toContain("North hopper");
      expect(markup).toContain("Current derived stock");
      if (type === "feedstock_bin") {
        expect(markup).toContain("Current estimated moisture");
      }
      expect(markup).toContain("Amount lost (kg)");
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
