import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GhgStatementCreateDialog } from "./ghg-statement-create-dialog";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";
import { SubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  refresh: vi.fn(),
  submit: vi.fn(),
  submitPending: false,
  submitSuccess: false,
  submitError: null as Error | null,
  submitData: null as { remoteStatus: string } | null,
  rootServerError: null as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh }),
}));

vi.mock("react-hook-form", () => ({
  useForm: ({ defaultValues }: { defaultValues: Record<string, unknown> }) => ({
    register: () => ({}),
    handleSubmit:
      (callback: (data: Record<string, unknown>) => unknown) => () =>
        callback(
          "facilityId" in defaultValues
            ? {
                facilityId: defaultValues.facilityId,
                reportingPeriodEndOn: "2026-07-31",
                confirmProduction: false,
              }
            : {
                externalReportUrl: "https://example.com/report.pdf",
                confirmProduction: false,
              },
        ),
    watch: () => "2026-07-31",
    trigger: () => Promise.resolve(true),
    reset: vi.fn(),
    setError: (_path: string, error: { message: string }) => {
      state.rootServerError = error.message;
    },
    setValue: vi.fn(),
    clearErrors: vi.fn(),
    formState: {
      errors: state.rootServerError
        ? { root: { serverError: { message: state.rootServerError } } }
        : {},
    },
  }),
}));

vi.mock("@/components/ui", () => ({
  buttonVariants: () => "button",
  Button: ({ children, onClick, type, disabled, busy }: {
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
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  ),
  EmptyState: () => <div>Empty</div>,
  Modal: ({
    children,
    isOpen,
  }: {
    children: ReactNode;
    isOpen: boolean;
  }) => (
    <div data-modal-open={String(isOpen)}>{isOpen ? children : null}</div>
  ),
}));

vi.mock("@/components/forms", () => ({
  FormField: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormInput: () => <input />,
  FormTextarea: () => <textarea />,
  ServerError: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("@/components/ui/accordion", () => ({
  Accordion: {
    Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
    Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/step-flow", () => ({
  StepFlow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({
    info: vi.fn(),
    success: state.toastSuccess,
    error: state.toastError,
    warning: state.toastWarning,
  }),
}));

vi.mock("@/hooks/use-certification", () => ({
  useCreateGhgStatement: () => ({
    data: undefined,
    isPending: false,
    mutateAsync: state.create,
  }),
  useGhgStatementsForFacility: () => ({ data: [], isSuccess: true }),
  useOpenRemovalsForFacility: () => ({ data: [{}] }),
  useRegistryGhgStatementsForFacility: () => ({ data: [] }),
  useSubmitGhgStatementToVerifier: () => ({
    error: state.submitError,
    isError: state.submitError !== null,
    isPending: state.submitPending,
    isSuccess: state.submitSuccess,
    data: state.submitData,
    mutateAsync: async (args: unknown) => {
      state.submitPending = true;
      try {
        const onProgress = (
          args as {
            onProgress?: (update: {
              step: string;
              state: "complete";
            }) => void;
          }
        ).onProgress;
        for (const step of [
          "ghg_statement.checking",
          "ghg_statement.preparing_report",
          "ghg_statement.sending",
          "ghg_statement.confirming",
          "ghg_statement.complete",
        ]) {
          onProgress?.({ step, state: "complete" });
        }
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
    reset: vi.fn(),
  }),
  useGhgStatementReports: () => ({
    data: [
      {
        id: "report-1",
        version: 1,
        lifecycle: "approved",
        reviewUrl: "/api/documents/report-1",
      },
    ],
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
  usePrepareGhgStatementReport: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useApproveGhgStatementReport: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock(
  "@/lib/isometric/utils/ghg-reporting-window",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/lib/isometric/utils/ghg-reporting-window")
    >();
    return {
      ...actual,
      derivePeriodStart: () => null,
      liveOverlapEnd: () => null,
      partitionByWindow: () => ({ inPeriod: [{}], outside: [] }),
    };
  },
);

vi.mock("./env-banner", () => ({ EnvBanner: () => <div>Sandbox</div> }));
vi.mock("./production-confirmation", () => ({
  ProductionConfirmation: () => <div>Confirm</div>,
}));
vi.mock("./removal-batches-accordion", () => ({
  RemovalBatchesAccordion: () => <div>Removals</div>,
}));
function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .find((button) => button.props.children === label);
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  state.create.mockReset();
  state.create.mockResolvedValue({
    externalId: "statement-1",
    linkedRemovalIds: ["removal-1"],
    outcome: "created",
    warnings: [],
  });
  state.refresh.mockReset();
  state.submit.mockReset();
  state.submit.mockResolvedValue({ remoteStatus: "SUBMITTED" });
  state.submitPending = false;
  state.submitSuccess = false;
  state.submitError = null;
  state.submitData = null;
  state.rootServerError = null;
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
  state.toastWarning.mockReset();
});

describe("GHG Statement route refreshes", () => {
  it("refreshes after a statement is created", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementCreateDialog
          facilityId="facility-1"
          isProduction={false}
          open
          onClose={vi.fn()}
        />,
      );
    });

    await act(async () => findButton(renderer!, "Next")?.props.onClick());
    await act(async () => findButton(renderer!, "Next")?.props.onClick());
    await act(async () =>
      findButton(renderer!, "Create GHG Statement")?.props.onClick(),
    );

    expect(state.create).toHaveBeenCalledOnce();
    expect(state.refresh).toHaveBeenCalledOnce();
    await act(async () => renderer?.unmount());
  });

  it("refreshes after a statement is submitted", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={vi.fn()}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    await act(async () => renderer?.root.findByType("form").props.onSubmit());

    expect(state.submit).toHaveBeenCalledOnce();
    expect(state.refresh).toHaveBeenCalledOnce();
    await act(async () => renderer?.unmount());
  });

  it("blocks duplicate submissions while the first request is pending", async () => {
    let resolveSubmission: ((value: { remoteStatus: string }) => void) | null =
      null;
    state.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmission = resolve;
        }),
    );

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={vi.fn()}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    let submission: Promise<unknown> | undefined;
    act(() => {
      submission = renderer?.root.findByType("form").props.onSubmit();
      void renderer?.root.findByType("form").props.onSubmit();
    });
    await act(async () => {
      renderer?.update(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={vi.fn()}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    expect(state.submit).toHaveBeenCalledOnce();
    expect(findButton(renderer!, "Submit")).toBeUndefined();
    expect(
      renderer!.root.findAllByType("h2").some((heading) =>
        String(heading.props.children).includes("Submitting GHG Statement"),
      ),
    ).toBe(true);

    await act(async () => {
      resolveSubmission?.({ remoteStatus: "AWAITING_VERIFICATION" });
      await submission;
    });
    await act(async () => renderer?.unmount());
  });

  it("keeps the controlled modal mounted while closed", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={vi.fn()}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    await act(async () => {
      renderer?.update(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen={false}
          onClose={vi.fn()}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    expect(
      renderer!.root.findByProps({ "data-modal-open": "false" }),
    ).toBeDefined();
    expect(renderer!.root.findAllByType("form")).toHaveLength(0);
    await act(async () => renderer?.unmount());
  });

  it("blocks registry actions until stale statement details are refreshed", async () => {
    const warning =
      "Statement details could not be refreshed. Showing the last loaded details. Use Refresh before generating or submitting.";
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={vi.fn()}
          isProduction={false}
          isResubmit={false}
          canGenerate={false}
          canSubmit={false}
          generationUnavailableReason={warning}
        />,
      );
    });

    expect(
      renderer!.root.findAllByType("p").some((node) =>
        String(node.props.children).includes(warning),
      ),
    ).toBe(true);
    expect(findButton(renderer!, "Generate new version")).toBeUndefined();
    expect(findButton(renderer!, "Submit")).toBeUndefined();

    const sourceOptions = renderer!.root.findAllByProps({
      name: "reportSource",
    });
    await act(async () => sourceOptions[1].props.onChange());
    expect(findButton(renderer!, "Submit")).toBeUndefined();
    await act(async () => renderer?.unmount());
  });

  it("shows the reconciled verifier status as the terminal success", async () => {
    state.submit.mockResolvedValue({
      remoteStatus: "AWAITING_VERIFICATION",
    });
    const onClose = vi.fn();

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={onClose}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    await act(async () => renderer?.root.findByType("form").props.onSubmit());
    await act(async () => {
      renderer?.update(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={onClose}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    expect(
      renderer!.root.findAllByType("h2").some((heading) =>
        String(heading.props.children).includes("GHG Statement submitted"),
      ),
    ).toBe(true);
    expect(
      renderer!.root.findAllByType("span").some((span) =>
        String(span.props.children).includes(
          "Isometric status: In verification. The reconciled status is saved in noma.",
        ),
      ),
    ).toBe(true);
    expect(
      renderer!.root.findAllByType("span").some((span) =>
        String(span.props.children).includes("Submission complete"),
      ),
    ).toBe(true);
    expect(state.toastSuccess).toHaveBeenCalledOnce();

    await act(async () => findButton(renderer!, "Done")?.props.onClick());
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer?.unmount());
  });

  it.each([
    [
      "DRAFT",
      "GHG Statement not submitted",
      "Isometric status: In registry. Review the submission before trying again.",
      "Review submission",
    ],
    [
      "FAILED_VERIFICATION",
      "GHG Statement verification failed",
      "Isometric status: Verification failed. Update the Removals, close this dialog, then use Refresh on the GHG Statement before resubmitting.",
      "Close",
    ],
  ])(
    "keeps fulfilled %s results actionable",
    async (remoteStatus, expectedTitle, expectedGuidance, expectedAction) => {
      state.submit.mockResolvedValue({ remoteStatus });
      const onClose = vi.fn();

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = create(
          <GhgStatementSubmitDialog
            ghgStatementId="statement-1"
            isOpen
            onClose={onClose}
            isProduction={false}
            isResubmit={false}
            canGenerate
          />,
        );
      });

      await act(async () => renderer?.root.findByType("form").props.onSubmit());
      await act(async () => {
        renderer?.update(
          <GhgStatementSubmitDialog
            ghgStatementId="statement-1"
            isOpen
            onClose={onClose}
            isProduction={false}
            isResubmit={false}
            canGenerate
          />,
        );
      });

      expect(
        renderer!.root.findAllByType("h2").some((heading) =>
          String(heading.props.children).includes(expectedTitle),
        ),
      ).toBe(true);
      expect(
        renderer!.root.findAllByType("span").some((span) =>
          String(span.props.children).includes(expectedGuidance),
        ),
      ).toBe(true);
      expect(findButton(renderer!, expectedAction)).toBeDefined();
      expect(findButton(renderer!, "Done")).toBeUndefined();
      if (remoteStatus === "FAILED_VERIFICATION") {
        expect(findButton(renderer!, "Review submission")).toBeUndefined();
        await act(async () =>
          findButton(renderer!, expectedAction)?.props.onClick(),
        );
        expect(onClose).toHaveBeenCalledOnce();
      }
      expect(
        renderer!.root.findAllByType("span").some((span) =>
          String(span.props.children).includes("Submission complete"),
        ),
      ).toBe(false);
      expect(state.toastSuccess).not.toHaveBeenCalled();
      if (remoteStatus === "FAILED_VERIFICATION") {
        expect(state.toastError).toHaveBeenCalledOnce();
        expect(state.toastWarning).not.toHaveBeenCalled();
      } else {
        expect(state.toastWarning).toHaveBeenCalledOnce();
        expect(state.toastError).not.toHaveBeenCalled();
      }
      await act(async () => renderer?.unmount());
    },
  );

  it("shows only the statement Refresh guidance when progress stalls", async () => {
    const stalledError = new SubmissionStreamStalledError();
    state.submit.mockRejectedValue(stalledError);

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={vi.fn()}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    await act(async () => renderer?.root.findByType("form").props.onSubmit());
    await act(async () => {
      renderer?.update(
        <GhgStatementSubmitDialog
          ghgStatementId="statement-1"
          isOpen
          onClose={vi.fn()}
          isProduction={false}
          isResubmit={false}
          canGenerate
        />,
      );
    });

    const visibleCopy = renderer!.root
      .findAll((node) => typeof node.children[0] === "string")
      .map((node) => String(node.children[0]));
    expect(visibleCopy).toContain(
      "Registry work may still be continuing. Close this dialog, then use Refresh on the GHG Statement before trying again.",
    );
    expect(visibleCopy).not.toContain(stalledError.message);
    await act(async () => renderer?.unmount());
  });
});
