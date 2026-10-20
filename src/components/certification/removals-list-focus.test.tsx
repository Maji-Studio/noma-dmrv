// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalListRow } from "./removal-list-state";
import { RemovalsList } from "./removals-list";

const FACILITY_ID = "facility-1";
const REMOVAL_ID = "11111111-1111-4111-8111-111111111111";
const BADGE_NAME = "Blocked, status history";

const mocks = vi.hoisted(() => ({ fetchCount: 0, lockReads: 0 }));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: () => [null, vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: FACILITY_ID, selectedFacility: { name: "Facility", code: "FAC" } }),
}));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: () => ({ isOpen: false, clear: vi.fn() }),
}));
// A real query, so a background refetch hands the list fresh data, as in the app.
vi.mock("@/hooks/use-certification", () => ({
  useRemovalsForFacility: () =>
    useQuery({
      queryKey: ["removals", FACILITY_ID],
      queryFn: async () => ({
        isProduction: false,
        fetchedAt: ++mocks.fetchCount,
        removals: [{ removal: { id: REMOVAL_ID } }],
      }),
    }),
  useRemovalPreflightSummaries: () => ({}),
  useFacilityCertifierSummary: () => ({ data: undefined }),
}));
vi.mock("@/lib/read-api/client", () => ({
  getRecordLocksRead: async () => {
    mocks.lockReads += 1;
    return { success: true, data: {} };
  },
}));
vi.mock("./removal-list-state", () => ({
  buildRemovalListRows: (identities: { removal: { id: string } }[]) =>
    identities.map((identity) => ({
      removalId: identity.removal.id,
      code: "RM-0001",
      startedOn: null,
      completedOn: null,
      memberBatchCodes: [],
      externalId: null,
      version: null,
      readiness: { reasons: [] },
    }) as unknown as RemovalListRow),
}));
vi.mock("@/lib/certification/status", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/certification/status")>(),
  deriveRemovalWorkflowStatus: () => ({ value: "blocked", label: "Blocked", reasons: [], canRetry: false }),
}));
vi.mock("./submission-status-history", () => ({ SubmissionStatusHistory: () => <p>History body</p> }));
vi.mock("./new-removal-dialog", () => ({ NewRemovalDialog: () => null }));
vi.mock("./removal-detail-sheet", () => ({ RemovalDetailSheet: () => null }));

let client: QueryClient;

// The desktop table; the phone cards repeat the badge.
function tableBadge() {
  return within(screen.getByRole("table", { name: "Removals" })).getByRole("button", { name: BADGE_NAME });
}

beforeEach(() => {
  mocks.fetchCount = 0;
  mocks.lockReads = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

async function openHistoryFromKeyboard() {
  render(
    <QueryClientProvider client={client}>
      <RemovalsList />
    </QueryClientProvider>,
  );
  await screen.findByRole("table", { name: "Removals" });
  await waitFor(() => expect(mocks.lockReads).toBeGreaterThan(0));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const badge = tableBadge();
  act(() => badge.focus());
  expect(document.activeElement).toBe(badge);
  // Enter on a focused button presses it.
  fireEvent.click(badge);
  await screen.findByRole("dialog", { name: "Status history" });
}

async function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Status history" })).toBeNull());
}

describe("Removals status history focus", () => {
  it("returns focus to the badge after Escape", async () => {
    await openHistoryFromKeyboard();
    await pressEscape();
    await waitFor(() => expect(document.activeElement).toBe(tableBadge()));
  });

  it("returns focus to the badge after Escape when a background refetch lands while the history is open", async () => {
    await openHistoryFromKeyboard();
    const fetchesBefore = mocks.fetchCount;
    const lockReadsBefore = mocks.lockReads;
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => {
      expect(mocks.fetchCount).toBeGreaterThan(fetchesBefore);
      expect(mocks.lockReads).toBeGreaterThan(lockReadsBefore);
    });
    expect(screen.getByRole("dialog", { name: "Status history" })).toBeTruthy();
    await pressEscape();
    await waitFor(() => expect(document.activeElement).toBe(tableBadge()));
  });
});
