import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { CHANGED_SINCE_REVIEW_FAILURE_KIND, INTERRUPTED_REMOVAL_CHANGED_MESSAGE } from "@/lib/certification/interrupted-removal-copy";
import { CONTEXT, findButton } from "./submit-step-test-helpers";
import { SubmitStep } from "./submit-step";

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

describe("SubmitStep failures", () => {
  it.each([
    ["differs", true],
    ["no-answer", false],
  ])("shows the %s outcome notice for the attempt that just ended (close only: %s)", async (kind, closeOnly) => {
    state.attempts = [{ id: "attempt-1", errorMessage: "Registry check failed", outcome: { kind } }];
    const mutation = {
      mutate: vi.fn(), isPending: false, isSuccess: false, isError: true, data: undefined,
      error: Object.assign(new Error("Registry check failed"), { attemptId: "attempt-1" }), reset: vi.fn(),
    };
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <SubmitStep removalId="removal-1" facilityId="facility-1" ctx={CONTEXT}
          onDone={vi.fn()} submitMutation={mutation as never} />,
      );
    });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain(`Outcome notice: ${kind}`);
    expect(findButton(renderer!, "Close") !== undefined).toBe(closeOnly);
    expect(findButton(renderer!, "Try again") !== undefined).toBe(!closeOnly);
    await act(async () => renderer?.unmount());
  });

  it("keeps the plain error when the newest attempt is an older failure", async () => {
    state.attempts = [{ id: "attempt-1", errorMessage: "An older failure", outcome: { kind: "differs" } }];
    const mutation = {
      mutate: vi.fn(), isPending: false, isSuccess: false, isError: true, data: undefined,
      error: new Error("Registry check failed"), reset: vi.fn(),
    };
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <SubmitStep removalId="removal-1" facilityId="facility-1" ctx={CONTEXT}
          onDone={vi.fn()} submitMutation={mutation as never} />,
      );
    });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("Registry check failed");
    expect(text).not.toContain("Outcome notice");
    await act(async () => renderer?.unmount());
  });

  it("keeps the plain ServerError for an unexpected failure without an attempt id", async () => {
    state.attempts = [{ id: "attempt-1", errorMessage: "Removal submission failed unexpectedly. Submit the Removal again.", outcome: { kind: "failed" } }];
    const message = "The submission could not be completed. Try again.";
    const mutation = {
      mutate: vi.fn(), isPending: false, isSuccess: false, isError: true, data: undefined,
      error: new Error(message), reset: vi.fn(),
    };
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SubmitStep removalId="removal-1" facilityId="facility-1" ctx={CONTEXT}
        onDone={vi.fn()} submitMutation={mutation as never} />);
    });
    expect(renderer!.root.findAllByType("div").some((node) => node.props.children === message)).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Outcome notice:");
    expect(findButton(renderer!, "Try again")).toBeDefined();
    await act(async () => renderer!.unmount());
  });

  describe("changed since review (#1114)", () => {
    // The notice is mocked here; its wording per viewer is covered in submission-outcome-notice.test.tsx.
    const ctx = { ...CONTEXT, latestSubmission: { status: "draft", lockedAt: null,
      metadata: { lastAttemptOutcome: "interrupted", externalMutation: "possible" } } } as RemovalCertifyContext;
    const labels = (r: ReactTestRenderer) => r.root.findAllByType("button").map((button) => button.children.join(""));
    async function renderFailed(error: Error, context = ctx) {
      let renderer: ReactTestRenderer | undefined;
      const mutation = { mutate: vi.fn(), isPending: false, isSuccess: false, isError: true, data: undefined, error, reset: vi.fn() };
      await act(async () => {
        renderer = create(<SubmitStep removalId="removal-1" facilityId="facility-1" ctx={context} onDone={vi.fn()} submitMutation={mutation as never} />);
      });
      return renderer!;
    }

    it.each([false, true])("leads with Delete Removal and drops Try again (summary loaded: %s)", async (loaded) => {
      if (loaded) state.attempts = [{ id: "attempt-1", errorMessage: INTERRUPTED_REMOVAL_CHANGED_MESSAGE, outcome: { kind: "changed" } }];
      const renderer = await renderFailed(Object.assign(new Error("The reviewed data changed."), { failureKind: CHANGED_SINCE_REVIEW_FAILURE_KIND, attemptId: "attempt-1" }));
      expect(JSON.stringify(renderer.toJSON())).toContain("Outcome notice: changed (can)");
      expect(JSON.stringify(renderer.toJSON())).not.toContain("safe retry");
      expect(labels(renderer)).toEqual(["Delete Removal", "Close"]);
      await act(async () => renderer.unmount());
    });

    it.each([false, true])("preserves the typed stop through onError (progress started: %s)", async (started) => {
      const mutation = { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null, reset: vi.fn() };
      let renderer: ReactTestRenderer;
      await act(async () => {
        renderer = create(<SubmitStep removalId="removal-1" facilityId="facility-1" ctx={ctx}
          onDone={vi.fn()} submitMutation={mutation as never} />);
      });
      await act(async () => { findButton(renderer!, "Submit again")!.props.onClick(); });
      await act(async () => {
        if (started) mutation.mutate.mock.calls[0][0].onProgress({ step: "removal.checking_data", state: "active" });
        mutation.mutate.mock.calls[0][1].onError(Object.assign(new Error("The reviewed data changed."), {
          failureKind: CHANGED_SINCE_REVIEW_FAILURE_KIND, attemptId: "attempt-1",
        }));
      });
      expect(JSON.stringify(renderer!.toJSON())).toContain("Outcome notice: changed (can)");
      expect(labels(renderer!)).toEqual(started ? ["Delete Removal", "Close"] : ["Delete Removal"]);
      await act(async () => renderer!.unmount());
    });

    it("asks a viewer below the role floor to get an Admin and offers only Close", async () => {
      state.deleteAccess = { viewerCanDeleteRegistryRemovals: false, hasRegisteredProductionBatches: false };
      const renderer = await renderFailed(Object.assign(new Error("The reviewed data changed."), { failureKind: CHANGED_SINCE_REVIEW_FAILURE_KIND, attemptId: "attempt-1" }));
      expect(JSON.stringify(renderer.toJSON())).toContain("Outcome notice: changed (ask-admin)");
      expect(labels(renderer)).toEqual(["Close"]);
      await act(async () => renderer.unmount());
    });

    it("keeps the exact changed sentence plain without a failure kind", async () => {
      const renderer = await renderFailed(new Error(INTERRUPTED_REMOVAL_CHANGED_MESSAGE));
      expect(JSON.stringify(renderer.toJSON())).toContain(INTERRUPTED_REMOVAL_CHANGED_MESSAGE);
      expect(JSON.stringify(renderer.toJSON())).not.toContain("Outcome notice:");
      expect(labels(renderer)).toEqual(["Try again", "Review submission"]);
      await act(async () => renderer.unmount());
    });

    it("keeps an onError message without a kind plain in the review footer", async () => {
      const mutation = { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null, reset: vi.fn() };
      let renderer: ReactTestRenderer;
      await act(async () => {
        renderer = create(<SubmitStep removalId="removal-1" facilityId="facility-1" ctx={ctx}
          onDone={vi.fn()} submitMutation={mutation as never} />);
      });
      await act(async () => { findButton(renderer!, "Submit again")!.props.onClick(); });
      await act(async () => {
        mutation.mutate.mock.calls[0][1].onError(new Error(INTERRUPTED_REMOVAL_CHANGED_MESSAGE));
      });
      expect(JSON.stringify(renderer!.toJSON())).toContain(INTERRUPTED_REMOVAL_CHANGED_MESSAGE);
      expect(JSON.stringify(renderer!.toJSON())).not.toContain("Outcome notice:");
      expect(labels(renderer!)).toEqual(["Submit again", "Delete Removal"]);
      await act(async () => renderer!.unmount());
    });

    it.each([true, false])("ignores an older attempt with equal error text (typed kind: %s)", async (changed) => {
      state.attempts = [{ id: "older-attempt", errorMessage: "The reviewed data changed.", outcome: { kind: "differs" } }];
      const error = Object.assign(new Error("The reviewed data changed."), {
        attemptId: "attempt-1", failureKind: changed ? CHANGED_SINCE_REVIEW_FAILURE_KIND : null,
      });
      const renderer = await renderFailed(error);
      const content = JSON.stringify(renderer.toJSON());
      expect(content).not.toContain("Outcome notice: differs");
      if (changed) {
        expect(content).toContain("Outcome notice: changed");
        expect(labels(renderer)).toEqual(["Delete Removal", "Close"]);
      } else {
        expect(content).not.toContain("Outcome notice:");
        expect(content).toContain(error.message);
        expect(labels(renderer)).toEqual(["Try again", "Review submission"]);
      }
      await act(async () => renderer.unmount());
    });

    it.each(["finalized", "running"])("does not offer deletion for a %s Removal with a typed stop", async (state) => {
      const context = state === "finalized"
        ? { ...ctx, hasFinalizedSubmission: true }
        : { ...ctx, latestSubmission: { ...ctx.latestSubmission, lockedAt: new Date(), metadata: { externalMutation: "possible" } } };
      const renderer = await renderFailed(Object.assign(new Error("The reviewed data changed."), {
        failureKind: CHANGED_SINCE_REVIEW_FAILURE_KIND, attemptId: "attempt-1",
      }), context as RemovalCertifyContext);
      expect(labels(renderer)).toEqual(["Close"]);
      await act(async () => renderer.unmount());
    });

    it("keeps Try again and offers no deletion after an ordinary failure", async () => {
      const renderer = await renderFailed(new Error("Registry check failed"));
      expect(labels(renderer)).toEqual(["Try again", "Review submission"]);
      await act(async () => renderer.unmount());
    });
  });

});
