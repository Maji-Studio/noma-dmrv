/**
 * Review & submit on first open (#1632): the build is read first, then the blocked Diesel row takes over
 * the emissions check. The operator did nothing, so nothing may ever be shown as fixed, and until the
 * build lands the area shows its loading line, never an empty list or "Ready to submit".
 * Driven through SubmitStep with the real fix list; only the data hooks and the component table are stubbed.
 */
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import type { ComponentRow } from "./component-table-model";
import { SubmitStep } from "./submit-step";

const MESSAGE = "Add a file for each entry.";
const EMISSIONS_CHECK = {
  key: "emissions", label: "Emissions", requirementLabel: "Emissions", unmetLabel: "Emissions entries without a file",
  status: "unmet", detail: MESSAGE,
} as RemovalRequirementCheck;
const DIESEL_ROW = {
  componentId: "diesel", name: "Diesel use", groupKey: "g", groupName: "G", state: "blocked", source: "", figure: null,
  fileCount: 0, fileEntryIds: [],
  blocked: { items: [{ message: MESSAGE, batchCodes: ["CB-1"], fixes: [{ label: "Review emissions", href: "/e", batchCode: null }] }] },
} as unknown as ComponentRow;

const build = vi.hoisted(() => ({
  // What useRemovalCompilation reports: first open is loading + fetching, a re-check is fetching only.
  query: { data: null as unknown, isLoading: true, isFetching: true, error: null as Error | null },
  rows: [] as unknown[],
  checks: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  buttonVariants: () => "button",
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => children, InfoHint: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: ({ message }: { message: string }) => <div>{message}</div> }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "" }) }));
vi.mock("../submission-outcome-notice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../submission-outcome-notice")>()),
  SubmissionOutcomeNotice: () => null,
}));
vi.mock("./component-table", () => ({ ComponentTable: () => null }));
vi.mock("./source-records", () => ({ SourceRecords: () => null }));
vi.mock("./debug-drawer", () => ({ DebugDrawer: () => null }));
vi.mock("./review-details", () => ({ ReviewDetails: () => null }));
vi.mock("../submit-confirm-dialog", () => ({ SubmitConfirmDialog: () => null }));
vi.mock("./shared-source-file-notices", () => ({ useSharedSourceFiles: () => [] }));
vi.mock("@/hooks/use-removal-empty-components", () => ({ useRefreshRemovalReview: () => vi.fn() }));
vi.mock("@/hooks/use-removal-delete-access", () => ({
  useRemovalDeleteAccess: () => ({ viewerCanDeleteRegistryRemovals: true, hasRegisteredProductionBatches: false }),
}));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-certification")>()),
  useRemovalSubmissionAttempts: () => ({ data: [] }),
  useDeleteRemoval: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
  useRemovalCompilation: () => ({ ...build.query, refetch: vi.fn() }),
}));
vi.mock("@/lib/certification/readiness-facts", () => ({ toRemovalReadinessFacts: () => ({}) }));
vi.mock("@/lib/certification/readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/certification/readiness")>()),
  buildRemovalRequirementsChecklist: () => build.checks,
  deriveRemovalReadiness: () => ({ state: "ready", reasons: [], advisories: [], transportVehicleAdvisories: [] }),
}));
vi.mock("./component-table-model", () => ({
  buildComponentTable: () => ({ loading: false, batches: [], rows: build.rows, groups: [] }),
}));
// The focus listener needs a browser; the fix list itself is real.
vi.mock("./use-fix-progress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-fix-progress")>()),
  useRecheckOnReturn: () => () => undefined,
}));
// Real fix list and summary; the verdict is the one thing derived here: loading while the build is read, else blocked.
vi.mock("./submission-facts", () => ({
  isRemovalCompilationReady: () => true,
  actionableSubmissionChecks: (checks: unknown[]) => checks,
  buildSubmissionFacts: ({ isCompilationLoading }: { isCompilationLoading: boolean }) => ({
    state: isCompilationLoading ? "loading" : "blocked",
    headline: isCompilationLoading ? "Preparing the submission" : "1 issue blocks submission",
    detail: "",
    batches: [{ id: "b", code: "CB-1" }],
    batchCount: 1,
    blockers: [],
    advisories: [],
    warnings: [],
    pendingDocuments: 0,
    dryTons: "",
    reportingWindowLabel: null,
  }),
}));

const CTX = { isProduction: false, latestSubmission: null, linkedGhgStatement: null, mapping: null, memberBatches: [], emissionLinesByBatchId: {}, emissionsLedger: {} } as unknown as RemovalCertifyContext;
const IDLE = { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, data: undefined, error: null, reset: vi.fn() };

const render = () => (
  <SubmitStep removalId="removal-1" facilityId="facility-1" ctx={CTX} onDone={vi.fn()} submitMutation={IDLE as never} />
);
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const rowStates = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.props["data-review-item"] !== undefined)
    .map((node) => node.props["data-review-item"] as string);

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  build.query = { data: null, isLoading: true, isFetching: true, error: null };
  build.rows = [];
  build.checks = [EMISSIONS_CHECK];
});

describe("Review & submit on first open", () => {
  it("shows the loading line, then the real list, and never a fixed item", async () => {
    const seen: string[][] = [];
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(render()); });
    seen.push(rowStates(renderer));
    // The build is still being read: the loading line, not a list and not "Ready to submit".
    expect(text(renderer)).toContain("Preparing the submission");
    expect(text(renderer)).not.toContain("Fix these to submit");
    expect(text(renderer)).not.toContain("Ready to submit");
    expect(rowStates(renderer)).toEqual([]);

    // The build lands: the blocked Diesel row carries what the emissions check said.
    build.query = { data: { blockers: [] }, isLoading: false, isFetching: false, error: null };
    build.rows = [DIESEL_ROW];
    await act(async () => renderer.update(render()));
    seen.push(rowStates(renderer));
    expect(text(renderer)).toContain("Diesel use");
    expect(text(renderer)).not.toContain("Emissions entries without a file");
    expect(text(renderer)).not.toContain("Preparing the submission");
    expect(rowStates(renderer)).toEqual(["open"]);
    expect(seen.flat()).not.toContain("fixed");
  });

  it("shows no loading line when the build is read again after a fix, and keeps the fixed item in place", async () => {
    build.query = { data: { blockers: [] }, isLoading: false, isFetching: false, error: null };
    build.rows = [DIESEL_ROW];
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(render()); });
    expect(rowStates(renderer)).toEqual(["open"]);

    // Back from a fix: the build is fetched again (not loading); the old list stays, no spinner line.
    build.query = { data: { blockers: [] }, isLoading: false, isFetching: true, error: null };
    await act(async () => renderer.update(render()));
    expect(text(renderer)).not.toContain("Preparing the submission");
    expect(rowStates(renderer)).toEqual(["open"]);

    // The fix landed: the row is gone, the item stays as done.
    build.query = { data: { blockers: [] }, isLoading: false, isFetching: false, error: null };
    build.rows = [];
    build.checks = [];
    await act(async () => renderer.update(render()));
    expect(rowStates(renderer)).toEqual(["fixed"]);
    expect(text(renderer)).not.toContain("Preparing the submission");
  });
});
