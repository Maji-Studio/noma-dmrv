import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GhgStatementCreateDialog } from "./ghg-statement-create-dialog";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  refresh: vi.fn(),
  submit: vi.fn(),
  prepareReport: vi.fn(),
  approveReport: vi.fn(),
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
    getValues: () => undefined,
    reset: vi.fn(),
    setError: vi.fn(),
    setValue: vi.fn(),
    clearErrors: vi.fn(),
    formState: { errors: {} },
  }),
}));

vi.mock("@/components/ui", () => ({
  buttonVariants: () => "button",
  Button: ({ children, onClick, type, disabled }: {
    children: ReactNode;
    onClick?: () => void;
    type?: "button" | "submit";
    disabled?: boolean;
  }) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  EmptyState: () => <div>Empty</div>,
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  StepFlow: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer?: ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
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
    error: null,
    isError: false,
    isPending: false,
    isSuccess: false,
    mutateAsync: state.submit,
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
  useGhgStatementBreakdown: () => ({
    data: {
      status: "available",
      value: {
        netRemovedKg: 1000,
        netBeforeDiscountKg: 1100,
        standardDeviationKg: null,
        riskOfReversalPercent: null,
        bufferCreditsKg: null,
        supplierCreditsKg: null,
        registryStatementId: "statement-1",
        registryStatementStatus: "DRAFT",
        ghgStatementId: "statement-local-1",
        externalId: "statement-1",
        reportingPeriodStartOn: "2026-01-01",
        reportingPeriodEndOn: "2026-01-31",
        memberRemovalCount: 1,
        isProduction: false,
      },
      message: "Exact registry roll-up available.",
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
  state.prepareReport.mockReset();
  state.prepareReport.mockResolvedValue({
    id: "report-1",
    version: 1,
  });
  state.approveReport.mockReset();
  state.approveReport.mockResolvedValue({
    id: "report-1",
    version: 1,
  });
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

    expect(findButton(renderer!, "Generate report")).toBeUndefined();
    expect(findButton(renderer!, "Approve report")).toBeUndefined();

    await act(async () => findButton(renderer!, "Next")?.props.onClick());
    expect(renderer!.root.findByProps({ id: "report-preview" })).toBeDefined();
    expect(findButton(renderer!, "Submit")).toBeDefined();
    await act(async () => renderer?.root.findByType("form").props.onSubmit());

    expect(state.prepareReport).toHaveBeenCalledOnce();
    expect(state.approveReport).toHaveBeenCalledWith({
      ghgStatementId: "statement-1",
      reportId: "report-1",
      version: 1,
    });
    expect(state.submit).toHaveBeenCalledOnce();
    expect(state.submit.mock.calls[0]?.[0]).toMatchObject({
      ghgStatementId: "statement-1",
      input: { reportId: "report-1" },
    });
    expect(state.refresh).toHaveBeenCalledOnce();
    await act(async () => renderer?.unmount());
  });
});
