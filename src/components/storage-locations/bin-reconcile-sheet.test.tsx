import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { label: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }) }));
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

const lossMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@/hooks/use-bin-movements", () => ({
  RecordLossConflictError: class RecordLossConflictError extends Error {},
  RecordLossFieldError: class RecordLossFieldError extends Error {
    constructor(message: string, readonly field: "lossMassKg" | "occurredAt") { super(message); }
  },
  useRecordLoss: () => ({ isPending: false, mutateAsync: lossMutation.mutateAsync }),
}));

import { RecordLossFieldError } from "@/hooks/use-bin-movements";
import { BinReconcileSheet } from "./bin-reconcile-sheet";

const storageLocation: StorageLocationWithFacility = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  code: "FB-001",
  name: "North hopper",
  stockMode: "split", drawOrder: "oldest_first",
  type: "feedstock_bin",
  capacityKg: null,
  storageMethod: null,
  storageDescription: null,
  feedstockTypeId: null,
  formulationId: null,
  facilityId: "00000000-0000-4000-8000-000000000003",
  archivedAt: null,
  createdAt: new Date("2026-01-01"),
  version: 1,
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
  it("shows a server time refusal on the time field and focuses it", async () => {
    const message = "Check the date and time";
    lossMutation.mutateAsync.mockRejectedValueOnce(new RecordLossFieldError(message, "occurredAt"));
    const focus = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<BinReconcileSheet open onOpenChange={() => undefined} storageLocation={storageLocation} />, {
        createNodeMock: (element) => (element.props as { id?: string }).id === "occurredAt" ? { focus } : {},
      });
    });
    try {
      await act(async () => {
        const mass = renderer.root.findAllByType("input").find(input => input.props.id === "loss-amount")!;
        await mass.props.onChange({ target: { name: "lossMassKg", value: "10" }, type: "change" });
        const reason = renderer.root.findByType("textarea");
        await reason.props.onChange({ target: { name: "reason", value: "Spilled stock" }, type: "change" });
      });
      await act(async () => {
        await renderer.root.findByType("form").props.onSubmit({ preventDefault() {}, persist() {} });
      });
      expect(lossMutation.mutateAsync).toHaveBeenCalled();
      expect(JSON.stringify(renderer.toJSON())).toContain(message);
      const time = renderer.root.findAllByType("input").find(input => input.props.id === "occurredAt")!;
      expect(time.props["aria-invalid"]).toBe("true");
      expect(focus).toHaveBeenCalled();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it.each([
    {
      type: "feedstock_bin",
      expectedStockLabel: "In the bin now",
      expectedStock: "150 kg",
      expectedLossLabel: "Wet mass lost",
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

      expect(markup).toContain("Lost mass");
      expect(markup).toContain("North hopper");
      expect(markup).toContain(expectedStockLabel);
      expect(markup).toContain("After this loss");
      expect(markup).toContain(expectedStock);
      if (showsMoisture) {
        expect(markup).toContain("Wet stock, 16.7% moisture");
      } else {
        expect(markup).not.toContain("moisture");
      }
      expect(markup).toContain(expectedLossLabel);
      expect(markup).toContain('id="loss-amount"');
      expect(markup).toContain('id="loss-reason"');
      expect(markup).toContain("Save lost mass");
      expect(markup).toContain("Cancel");

      expect(markup).not.toContain("Reconciliation type");
      expect(markup).not.toContain("Record stock-take");
      expect(markup).not.toContain("Counted stock");
      expect(markup).not.toContain('id="moisture-percent"');
    },
  );
});

vi.mock("@/hooks/use-output-stock", () => ({
  useOutputSubBins: () => ({ data: { stockMode: "mix", subBins: [] }, error: null }),
  useOutputStockBalance: () => ({ data: undefined }),
  useOutputStockPreview: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }),
  usePostOutputStock: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

describe("Output-bin reconciliation", () => {
  it.each(["biochar_bin", "product_bin"] as const)("opens directly on lost mass for %s", (type) => {
    const markup = renderToStaticMarkup(<BinReconcileSheet open onOpenChange={() => undefined} storageLocation={{ ...storageLocation, type }} />);
    expect(markup).toContain("Wet mass removed (kg)");
    expect(markup).toContain("Moisture (%)");
    expect(markup).toContain("Save lost mass");
    expect(markup).not.toContain("Reconcile stock");
    expect(markup).not.toContain("Counted wet mass");
    expect(markup).not.toContain("Current derived stock");
  });
});
