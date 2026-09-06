import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";
import type { SubmissionProgressUpdate } from "@/lib/certification/submission-progress";

const state = vi.hoisted(() => ({
  submit: vi.fn(),
  prepareReport: vi.fn(),
  approveReport: vi.fn(),
  progressRuns: [] as SubmissionProgressUpdate[][],
  submitPending: false,
  submitSuccess: false,
  submitError: null as Error | null,
  submitData: null as { remoteStatus: string } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: () => ({}),
    handleSubmit:
      (callback: (data: Record<string, unknown>) => unknown) => () =>
        callback({ confirmProduction: false }),
    formState: { errors: {} },
    setError: vi.fn(),
    setValue: vi.fn(),
    clearErrors: vi.fn(),
    getValues: vi.fn(),
    trigger: () => Promise.resolve(true),
  }),
}));

vi.mock("@/components/ui", () => ({
  Button: ({
    children,
    onClick,
    type,
    disabled,
    busy,
  }: {
    children: ReactNode;
    onClick?: () => void;
    type?: "button" | "submit";
    disabled?: boolean;
    busy?: boolean;
  }) => (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {children}
    </button>
  ),
  Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}));

vi.mock("@/components/forms", () => ({
  FormField: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormInput: () => <input />,
  FormTextarea: () => <textarea />,
  ServerError: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("@/components/ui/step-flow", () => ({
  StepFlow: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-certification", () => ({
  useSubmitGhgStatementToVerifier: () => ({
    error: state.submitError,
    isError: state.submitError !== null,
    isPending: state.submitPending,
    isSuccess: state.submitSuccess,
    data: state.submitData,
    mutateAsync: async (args: {
      onProgress: (update: SubmissionProgressUpdate) => void;
    }) => {
      state.submitPending = true;
      for (const update of state.progressRuns.shift() ?? []) {
        args.onProgress(update);
      }
      try {
        const result = await state.submit(args);
        state.submitData = result;
        state.submitSuccess = true;
        return result;
      } catch (error) {
        state.submitError =
          error instanceof Error ? error : new Error("Submission failed.");
        throw error;
      } finally {
        state.submitPending = false;
      }
    },
    reset: () => {
      state.submitError = null;
      state.submitSuccess = false;
      state.submitData = null;
    },
  }),
  useGhgStatementBreakdown: () => ({
    data: {
      status: "available",
      value: {
        reportingPeriodStartOn: "2026-01-01",
        reportingPeriodEndOn: "2026-01-31",
        memberRemovalCount: 1,
      },
    },
    isLoading: false,
  }),
  usePrepareGhgStatementReport: () => ({
    isPending: false,
    mutateAsync: state.prepareReport,
  }),
  useApproveGhgStatementReport: () => ({
    isPending: false,
    mutateAsync: state.approveReport,
  }),
}));

vi.mock("./ghg-statement-carbon-breakdown", () => ({
  GhgStatementCarbonBreakdown: () => <div>Carbon breakdown</div>,
}));

vi.mock("./production-confirmation", () => ({
  ProductionConfirmation: () => null,
}));

function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .find((button) => button.props.children === label);
}

function renderDialog(isResubmit: boolean) {
  return (
    <GhgStatementSubmitDialog
      ghgStatementId="statement-1"
      isOpen
      onClose={vi.fn()}
      isProduction={false}
      isResubmit={isResubmit}
      canGenerate
    />
  );
}

async function prepareAndReview(renderer: ReactTestRenderer) {
  await act(async () => findButton(renderer, "Next")?.props.onClick());
  const review = renderer.root
    .findAllByType("a")
    .find((link) => link.props.children === "Review report");
  await act(async () => review?.props.onClick());
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  state.submit.mockReset();
  state.prepareReport.mockReset().mockResolvedValue({
    id: "report-1",
    version: 1,
    lifecycle: "prepared",
    reviewUrl: "/api/documents/report-1",
  });
  state.approveReport.mockReset().mockResolvedValue({
    id: "report-1",
    version: 1,
    lifecycle: "approved",
    reviewUrl: "/api/documents/report-1",
  });
  state.progressRuns = [];
  state.submitPending = false;
  state.submitSuccess = false;
  state.submitError = null;
  state.submitData = null;
});

describe("GHG Statement retry progress", () => {
  it.each(["Try again", "Review submission"] as const)(
    "treats %s after a first-attempt failure as a retry without reused events",
    async (retryPath) => {
      state.submit.mockRejectedValue(new Error("Registry request failed."));
      state.progressRuns = [
        [{ step: "ghg_statement.checking", state: "complete" }],
        [
          { step: "ghg_statement.checking", state: "complete" },
          { step: "ghg_statement.confirming", state: "active" },
        ],
      ];
      let renderer: ReactTestRenderer;
      await act(async () => {
        renderer = create(renderDialog(false));
      });
      await prepareAndReview(renderer!);
      await act(async () => renderer!.root.findByType("form").props.onSubmit());
      await act(async () => renderer!.update(renderDialog(false)));

      await act(async () => findButton(renderer!, retryPath)?.props.onClick());
      if (retryPath === "Review submission") {
        await act(async () => renderer!.update(renderDialog(false)));
        await act(async () =>
          renderer!.root.findByType("form").props.onSubmit(),
        );
      }
      await act(async () => renderer!.update(renderDialog(false)));

      const output = JSON.stringify(renderer!.toJSON());
      expect(state.submit).toHaveBeenCalledTimes(2);
      expect(output).toContain("Confirming registry response");
      expect(output).not.toContain("Preparing verifier document");
      expect(output).not.toContain("Already sent");
      await act(async () => renderer!.unmount());
    },
  );

  it("freezes resubmission progress when refreshed context changes mode", async () => {
    let resolveSubmission: ((result: { remoteStatus: string }) => void) | null =
      null;
    state.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmission = resolve;
        }),
    );
    state.progressRuns = [
      [{ step: "ghg_statement.checking", state: "active" }],
    ];
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderDialog(true));
    });
    await prepareAndReview(renderer!);

    act(() => {
      void renderer!.root.findByType("form").props.onSubmit();
    });
    await act(async () => renderer!.update(renderDialog(false)));

    expect(JSON.stringify(renderer!.toJSON())).not.toContain(
      "Preparing verifier document",
    );
    await act(async () => {
      resolveSubmission?.({ remoteStatus: "AWAITING_VERIFICATION" });
    });
    await act(async () => renderer!.unmount());
  });
});
