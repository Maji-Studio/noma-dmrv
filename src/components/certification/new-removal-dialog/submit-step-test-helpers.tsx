import type { ReactNode } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, vi } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  compileRefetch: vi.fn(),
  toastSuccess: vi.fn(),
  discardMutate: vi.fn(),
  discardReset: vi.fn(),
  attempts: [] as Array<{ id: string; errorMessage: string | null; outcome: { kind: string } }>,
  deleteAccess: {
    viewerCanDeleteRegistryRemovals: true as boolean | null,
    hasRegisteredProductionBatches: false as boolean | null,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh }),
}));

vi.mock("@/components/ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  buttonVariants: () => "button",
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: state.toastSuccess }),
}));

vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <button type="button" onClick={onConfirm}>
        Confirm discard
      </button>
    ) : null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  InfoHint: () => null,
}));

vi.mock("./component-table", () => ({ ComponentTable: () => null }));
vi.mock("./component-table-model", () => ({
  buildComponentTable: () => ({ loading: false, batches: [], rows: [], groups: [] }),
}));
vi.mock("./source-records", () => ({ SourceRecords: () => null }));
vi.mock("./shared-source-file-notices", () => ({ useSharedSourceFiles: () => [] }));

vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "Africa/Dar_es_Salaam", hint: "" }),
}));

vi.mock("../submission-outcome-notice", async (importOriginal) => ({
  deleteAccessFor: (await importOriginal<typeof import("../submission-outcome-notice")>()).deleteAccessFor,
  SubmissionOutcomeNotice: ({ outcome, deleteAccess }: { outcome: { kind: string }; deleteAccess?: string }) => (
    <div>{`Outcome notice: ${outcome.kind}${deleteAccess ? ` (${deleteAccess})` : ""}`}</div>
  ),
}));

vi.mock("@/hooks/use-certification", () => ({
  useRemovalSubmissionAttempts: () => ({ data: state.attempts }),
  useDeleteRemoval: () => ({
    mutate: state.discardMutate,
    isPending: false,
    error: null,
    reset: state.discardReset,
  }),
  useRemovalCompilation: () => ({
    data: {
      blockers: [],
      compilationHash: "compilation-hash",
      snapshot: {},
    },
    isLoading: false,
    error: null,
    refetch: state.compileRefetch,
  }),
}));

vi.mock("@/hooks/use-removal-delete-access", () => ({
  useRemovalDeleteAccess: () => state.deleteAccess,
}));

vi.mock("@/lib/certification/readiness", () => ({
  buildRemovalRequirementsChecklist: () => [],
  deriveRemovalReadiness: () => ({
    state: "ready",
    reasons: [],
    advisories: [], transportVehicleAdvisories: [],
  }),
}));

vi.mock("@/lib/certification/readiness-facts", () => ({
  toRemovalReadinessFacts: () => ({}),
}));

const factsState = vi.hoisted(() => ({ state: "ready" as "ready" | "blocked" | "loading", recheck: null as null | (() => void) }));

vi.mock("./submission-facts", () => ({
  isRemovalCompilationReady: () => true,
  actionableSubmissionChecks: (checks: unknown[]) => checks,
  buildSubmissionFacts: () => ({
    state: factsState.state, headline: "", detail: "", batches: [], blockers: [], advisories: [], warnings: [],
  }),
}));

// The focus listener needs a browser; the fix list itself is real.
vi.mock("./use-fix-progress", async (importOriginal) => ({
  ...await importOriginal<typeof import("./use-fix-progress")>(),
  useRecheckOnReturn: (refresh: () => void) => {
    factsState.recheck = refresh;
    return () => undefined;
  },
}));
vi.mock("./review-details", () => ({ ReviewDetails: () => <div>Review details</div> }));
vi.mock("@/hooks/use-removal-empty-components", () => ({ useRefreshRemovalReview: () => vi.fn() }));

vi.mock("./submission-summary", () => ({
  SubmissionSummary: () => <div>Submission summary</div>,
}));

vi.mock("./debug-drawer", () => ({
  DebugDrawer: () => null,
}));

vi.mock("../submit-confirm-dialog", () => ({
  SubmitConfirmDialog: () => null,
}));

export const CONTEXT = {
  isProduction: false,
  latestSubmission: null,
  linkedGhgStatement: null,
  mapping: null,
  emissionsLedger: {
    inputs: [],
    inputsUnavailable: true,
    claims: [],
    creditBatches: [],
    productionRuns: [],
    applications: [],
  },
} as unknown as RemovalCertifyContext;

export function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .find((button) => button.props.children === label);
}

export function findLink(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("a")
    .find((link) => link.props.children?.[0] === label);
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  state.refresh.mockReset();
  state.toastSuccess.mockReset();
  state.discardMutate.mockReset();
  state.discardReset.mockReset();
  state.attempts = [];
  factsState.state = "ready";
  state.deleteAccess = {
    viewerCanDeleteRegistryRemovals: true,
    hasRegisteredProductionBatches: false,
  };
});

export { state, factsState };
