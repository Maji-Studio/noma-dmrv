import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GhgStatementCreateDialog } from "./ghg-statement-create-dialog";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  refresh: vi.fn(),
  submit: vi.fn(),
  mutationReset: vi.fn(),
  modalOnOpen: undefined as (() => void) | undefined,
  submitPending: false,
  submitSuccess: false,
  submitError: null as Error | null,
  submitData: null as { remoteStatus: string } | null,
  toastSuccess: vi.fn(),
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
    setError: vi.fn(),
    setValue: vi.fn(),
    clearErrors: vi.fn(),
    formState: { errors: {} },
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
    onOpen,
  }: {
    children: ReactNode;
    onOpen?: () => void;
  }) => {
    state.modalOnOpen = onOpen;
    return <div>{children}</div>;
  },
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
    warning: vi.fn(),
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
    reset: state.mutationReset,
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
vi.mock("./submission-progress", () => ({
  SubmissionProgress: () => <div>Progress</div>,
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
  state.mutationReset.mockReset();
  state.mutationReset.mockImplementation(() => {
    state.submitPending = false;
    state.submitSuccess = false;
    state.submitError = null;
    state.submitData = null;
  });
  state.modalOnOpen = undefined;
  state.submitPending = false;
  state.submitSuccess = false;
  state.submitError = null;
  state.submitData = null;
  state.toastSuccess.mockReset();
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

  it("keeps a fast submission pending when the modal open effect runs late", async () => {
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
    act(() => state.modalOnOpen?.());
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

    expect(state.mutationReset).not.toHaveBeenCalled();
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
          "Isometric status: Awaiting verification. The reconciled status is saved in noma.",
        ),
      ),
    ).toBe(true);

    await act(async () => findButton(renderer!, "Done")?.props.onClick());
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer?.unmount());
  });
});
