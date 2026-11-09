// @vitest-environment jsdom
/**
 * The details view's links reach the re-check end to end: pressing a credit
 * batch link or a record link, then returning to the tab, reads the review
 * again (the same wiring SubmitStep builds with markFixUsed).
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/hooks/use-removal-records", () => ({
  useRemovalRecords: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    data: [
      {
        creditBatchId: "cb-1",
        code: "CB-26-001",
        startDate: "2026-02-01",
        endDate: "2026-03-01",
        productionRuns: [{ id: "pr-1", code: "PR-1", kind: "productionRun", date: "2026-02-02", place: "Reactor 1", massKg: 100, basis: "dry" }],
        applications: [],
        deliveries: [],
        feedstock: [],
      },
    ],
  }),
}));
vi.mock("@/hooks/use-documents", () => ({ useDocumentsForEntity: () => ({ data: [] }) }));
vi.mock("./debug-drawer", () => ({ DebugDrawer: () => null }));

import { ReviewDetails } from "./review-details";
import { useRecheckOnReturn } from "./use-fix-progress";

const TABLE = {
  batches: [{ id: "cb-1", code: "CB-26-001", startDate: "2026-02-01", endDate: "2026-03-01", dryTons: 1, claim: null }],
  groups: [],
  rows: [],
  loading: false,
} as never;

const refresh = vi.fn();

const CARRIED = [
  {
    entryId: "e1", creditBatchCode: "CB-26-009", creditBatchId: "cb-9", occurredOn: "2026-09-14",
    componentId: "diesel", componentName: "Diesel use", value: { magnitude: "120", unit: "l" },
    evidenceDocumentIds: [], earlierRemovalCode: "RM-26-009", earlierRemovalId: "rm-9",
  },
];

function Host({ carriedEntries = [] }: { carriedEntries?: unknown[] }) {
  const markFixUsed = useRecheckOnReturn(refresh);
  return (
    <ReviewDetails
      ctx={{ carriedEntries, mapping: null, isProduction: false } as never}
      facilityId="f1"
      removalId="rm-1"
      facts={{ durabilityTiers: ["1000-year"], samplingLabel: "Sampled credit batches" } as never}
      table={TABLE}
      compilation={null}
      isCompilationLoading={false}
      compilationError={null}
      passedChecks={[]}
      onBack={() => undefined}
      onFix={markFixUsed}
      onRetryCompilation={() => undefined}
    />
  );
}

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

function returnToTab() {
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
}

describe("details view re-check", () => {
  it("reads the review again after a credit batch link in the table header was used", () => {
    render(<Host />);
    returnToTab();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("region", { name: "Components" })).getByRole("link", { name: /CB-26-001/ }));
    returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads the review again after a link in the carried emissions panel was used", () => {
    render(<Host carriedEntries={CARRIED} />);
    const panel = screen.getByRole("region", { name: "Emissions from other credit batches" });
    fireEvent.click(within(panel).getByRole("link", { name: /RM-26-009/ }));
    returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    fireEvent.click(within(panel).getAllByRole("link", { name: /CB-26-009/ })[0]);
    returnToTab();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reads the review again after a record link in Records was used, on each return", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: /Records of CB-26-001/ }));
    fireEvent.click(screen.getByRole("link", { name: "PR-1" }));
    returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    returnToTab();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
