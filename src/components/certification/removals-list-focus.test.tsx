// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalListRow } from "./removal-list-state";
import { RemovalsList } from "./removals-list";

const FACILITY_ID = "facility-1";
const REMOVAL_ID = "11111111-1111-4111-8111-111111111111";
const NEWER_REMOVAL_ID = "22222222-2222-4222-8222-222222222222";
const BADGE_NAME = "Blocked, status history";

const mocks = vi.hoisted(() => ({
  fetchCount: 0, lockReads: 0, removalIds: [] as string[],
  query: {} as Record<string, string | null>,
  facilityId: "facility-1", linkedFacilityId: "facility-1", missing: false,
  setFacilityId: vi.fn(), toastError: vi.fn(),
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (param: string) => [mocks.query[param] ?? null, (value: string | null) => { mocks.query[param] = value; }],
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
  useFacilityContext: () => ({
    facilityId: mocks.facilityId, selectedFacility: { name: "Facility", code: "FAC" },
    facilities: [{ id: FACILITY_ID }, { id: "facility-2" }], setFacilityId: mocks.setFacilityId,
  }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toastError }) }));
vi.mock("@/hooks/use-removal-carried-entries", () => ({
  useRemovalCarriedEntries: (id: string | null) => ({
    data: id && !mocks.missing ? { facilityId: mocks.linkedFacilityId, carriedEntries: [], lateEntries: [] } : undefined,
    isLoading: false, isError: !!id && mocks.missing, isSuccess: !!id && !mocks.missing,
  }),
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
        removals: mocks.removalIds.map((id) => ({ removal: { id } })),
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
      code: identity.removal.id === REMOVAL_ID ? "RM-0001" : "RM-0002",
      startedOn: null,
      completedOn: null,
      memberBatchCodes: [],
      externalId: null,
      version: null,
      submittedOn: { kind: "never" },
      readiness: { reasons: [] },
    }) as unknown as RemovalListRow),
}));
vi.mock("@/lib/certification/status", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/certification/status")>(),
  deriveRemovalWorkflowStatus: () => ({ value: "blocked", label: "Blocked", reasons: [], canRetry: false }),
}));
vi.mock("./submission-status-history", () => ({ SubmissionStatusHistory: () => <p>History body</p> }));
vi.mock("./new-removal-dialog", () => ({ NewRemovalDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div role="dialog">Resume Removal</div> : null }));
vi.mock("./removal-detail-sheet", () => ({ RemovalDetailSheet: () => <div role="dialog">Linked Removal</div> }));

let client: QueryClient;

// The desktop table; the phone cards repeat the badge. Each row's badge has the same name.
function tableBadge(code = "RM-0001") {
  const table = screen.getByRole("table", { name: "Removals" });
  const row = within(table).getByText(code).closest("tr");
  if (!row) throw new Error(`No row for ${code}`);
  return within(row).getByRole("button", { name: BADGE_NAME });
}

beforeEach(() => {
  mocks.query = {};
  mocks.facilityId = FACILITY_ID;
  mocks.linkedFacilityId = FACILITY_ID;
  mocks.missing = false;
  mocks.setFacilityId.mockClear();
  mocks.toastError.mockClear();
  mocks.fetchCount = 0;
  mocks.lockReads = 0;
  mocks.removalIds = [REMOVAL_ID];
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

  it("keeps the open history with its Removal when a refetch puts a newer Removal first", async () => {
    await openHistoryFromKeyboard();
    mocks.removalIds = [NEWER_REMOVAL_ID, REMOVAL_ID];
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(tableBadge("RM-0002")).toBeTruthy());
    expect(tableBadge("RM-0001").getAttribute("aria-expanded")).toBe("true");
    expect(tableBadge("RM-0002").getAttribute("aria-expanded")).toBe("false");
    await pressEscape();
    await waitFor(() => expect(document.activeElement).toBe(tableBadge("RM-0001")));
  });
});


describe("Removal record links", () => {
  it.each(["removal", "resume"])("follows the facility for ?%s= and keeps its record param", async (param) => {
    mocks.query[param] = REMOVAL_ID;
    mocks.linkedFacilityId = "facility-2";
    const view = render(<QueryClientProvider client={client}><RemovalsList /></QueryClientProvider>);
    await waitFor(() => expect(mocks.setFacilityId).toHaveBeenCalledWith("facility-2"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.query[param]).toBe(REMOVAL_ID);
    expect(mocks.toastError).not.toHaveBeenCalled();
    mocks.facilityId = "facility-2";
    view.rerender(<QueryClientProvider client={client}><RemovalsList /></QueryClientProvider>);
    await screen.findByRole("dialog");
    expect(screen.getByRole("dialog").textContent).toBe(param === "resume" ? "Resume Removal" : "Linked Removal");
  });

  it.each(["removal", "resume"])("clears a missing ?%s= and reports it", async (param) => {
    mocks.query[param] = REMOVAL_ID;
    mocks.missing = true;
    render(<QueryClientProvider client={client}><RemovalsList /></QueryClientProvider>);
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith("Linked Removal could not be opened"));
    expect(mocks.query[param]).toBeNull();
    expect(mocks.setFacilityId).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
