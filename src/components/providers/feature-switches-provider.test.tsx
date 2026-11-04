// @vitest-environment jsdom
/** Controls that would only lead to a refusal stay hidden when their switch is off. */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "" }) }));
vi.mock("@/hooks/use-output-stock", () => ({ useOutputStockBalance: () => ({ data: undefined, error: undefined }) }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/hooks/use-record-locks", () => ({ useRecordLocks: () => ({ locks: {} }) }));
const tileActions = vi.hoisted(() => ({ labels: [] as string[] }));
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string }> }) => {
    tileActions.labels = actions.map((action) => action.label);
    return null;
  },
}));

import { StockReconciliationLink } from "@/components/forms/stock-reconciliation-link";
import { StockCard } from "@/components/storage-locations/stock-card";
import { StorageBinTile } from "@/components/storage-locations/storage-bin-tile";
import { StorageBinBoard } from "@/components/storage-locations/storage-bin-board";
import { FeatureSwitchesProvider, useFeatureSwitches, type FeatureSwitches } from "./feature-switches-provider";

const ON: FeatureSwitches = { mcp: true, stockAdjustments: true, multiBinRuns: true };
const OFF: FeatureSwitches = { mcp: false, stockAdjustments: false, multiBinRuns: false };

const negativeBin = { id: "bin", facilityId: "facility", name: "Fixture bin", code: "BIN", type: "feedstock_bin", archivedAt: null,
  feedstockInventory: { currentWetMassKg: -5, feedstockTypes: [], batchCount: 0, pendingBatchCount: 0 }, capacityKg: 100, lastActivity: null } as unknown as StorageLocationWithFacility;

function Probe() {
  const value = useFeatureSwitches();
  return <p>{JSON.stringify(value)}</p>;
}

afterEach(() => { cleanup(); tileActions.labels = []; });

describe("feature switches context", () => {
  it("reads everything off without a provider", () => {
    render(<Probe />);
    expect(screen.getByText(JSON.stringify(OFF))).toBeTruthy();
  });
});

describe("Open bin reconciliation link", () => {
  it("is absent with stock adjustments off and present with them on", () => {
    const { rerender } = render(<FeatureSwitchesProvider value={OFF}><StockReconciliationLink /></FeatureSwitchesProvider>);
    expect(screen.queryByText("Open bin reconciliation")).toBeNull();
    rerender(<FeatureSwitchesProvider value={ON}><StockReconciliationLink /></FeatureSwitchesProvider>);
    expect(screen.getByText("Open bin reconciliation")).toBeTruthy();
  });
});

describe("stock card Adjust stock action", () => {
  it("is absent with stock adjustments off and present with them on", () => {
    const card = <StockCard title="Stock" hint="hint" onAdjust={vi.fn()} />;
    const { rerender } = render(<FeatureSwitchesProvider value={OFF}>{card}</FeatureSwitchesProvider>);
    expect(screen.queryByRole("button", { name: /Adjust stock/ })).toBeNull();
    rerender(<FeatureSwitchesProvider value={ON}>{card}</FeatureSwitchesProvider>);
    expect(screen.getByRole("button", { name: /Adjust stock/ })).toBeTruthy();
  });
});

describe("bin tile Reconcile link", () => {
  it("is absent with stock adjustments off and present with them on", () => {
    const tile = <StorageBinTile bin={negativeBin} actions={[]} onView={vi.fn()} onReconcile={vi.fn()} />;
    const { rerender } = render(<FeatureSwitchesProvider value={OFF}>{tile}</FeatureSwitchesProvider>);
    expect(screen.queryByRole("button", { name: /Reconcile/ })).toBeNull();
    rerender(<FeatureSwitchesProvider value={ON}>{tile}</FeatureSwitchesProvider>);
    expect(screen.getByRole("button", { name: /Reconcile/ })).toBeTruthy();
  });
});

describe("bin board row menu", () => {
  const noop = vi.fn();
  const board = (switches: FeatureSwitches) => (
    <FeatureSwitchesProvider value={switches}>
      <StorageBinBoard bins={[{ ...negativeBin, feedstockInventory: { currentWetMassKg: 10, feedstockTypes: [], batchCount: 0, pendingBatchCount: 0 } } as unknown as StorageLocationWithFacility]} isLoading={false} isStale={false} laneSummary={{
        feedstock_bin: { binCount: 1, onHandKg: 10, basis: "wet" }, biochar_bin: { binCount: 0, onHandKg: 0, basis: "wet" },
        product_bin: { binCount: 0, onHandKg: 0, basis: "wet" } } as never}
      total={1} searchQuery="" onSearchChange={noop} typeFilter="all" onTypeFilterChange={noop} sortValue="recent" onSortChange={noop}
      showArchived={false} onToggleArchived={noop} hasActiveFilters={false} onClearFilters={noop} page={1} pageCount={1} pageSize={20}
      onPageChange={noop} onPageSizeChange={noop} onCreate={noop} onView={noop} onEdit={noop} onArchive={noop} onRestore={noop}
      onDelete={noop} onReconcile={noop} />
    </FeatureSwitchesProvider>
  );
  it("lists Adjust stock only with stock adjustments on", () => {
    const { rerender } = render(board(OFF));
    expect(tileActions.labels).toContain("Archive");
    expect(tileActions.labels).not.toContain("Adjust stock");
    rerender(board(ON));
    expect(tileActions.labels).toContain("Adjust stock");
  });
});
