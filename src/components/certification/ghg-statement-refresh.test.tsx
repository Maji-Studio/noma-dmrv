import { useState, type ReactNode } from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GhgStatementsList } from "./ghg-statements-list";
import { GhgStatementDetailSheet } from "./ghg-statement-detail-sheet";
import { GhgStatementCreateDialog } from "./ghg-statement-create-dialog";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";
import { SubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";

const REPORT_STEP_INDEX = 0;
const { GHG_LIST_QUERY_KEY } = vi.hoisted(() => ({
  GHG_LIST_QUERY_KEY: ["ghg-list"] as const,
}));

const state = vi.hoisted(() => ({
  client: null as QueryClient | null,
  list: vi.fn(),
  detail: vi.fn(),
  summaryError: false,
  create: vi.fn(),
  refresh: vi.fn(),
  submit: vi.fn(),
  prepareReport: vi.fn(),
  approveReport: vi.fn(),
  breakdownStatus: "available" as "available" | "unavailable",
  breakdownMessage: "Exact registry roll-up available.",
  submitPending: false,
  submitSuccess: false,
  submitError: null as Error | null,
  submitData: null as { remoteStatus: string } | null,
  rootServerError: null as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: () => useState<string | null>(null),
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));
vi.mock("@/components/ui/data-table", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DataTable: Object.assign(
      ({ data, onRowClick }: {
        data: { statement: { id: string } }[];
        onRowClick: (row: { statement: { id: string } }) => void;
      }) => (
        <div data-testid="statement-list">
          {data.map((row) => (
            <button key={row.statement.id} onClick={() => onRowClick(row)}>
              Open statement
            </button>
          ))}
        </div>
      ),
      { Toolbar: Wrapper, Search: Wrapper, Controls: Wrapper,
        ColumnVisibility: Wrapper, Pagination: Wrapper },
    ),
  };
});
vi.mock("@/components/ui/slide-over-panel", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { SlideOverPanel: {
    Root: Wrapper, Content: Wrapper, Header: Wrapper, Title: Wrapper,
    Description: Wrapper, Body: Wrapper, Footer: Wrapper, Close: Wrapper,
  } };
});
vi.mock("./ghg-statement-carbon-breakdown", () => ({
  GhgStatementCarbonBreakdown: () => <div>Carbon breakdown</div>,
}));
vi.mock("./ghg-statement-technical-details", () => ({
  GhgStatementTechnicalDetails: () => null,
}));
vi.mock("./registry-record-link", () => ({ RegistryRecordLink: () => null }));

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
  PageHeader: () => <h1>GHG Statements</h1>,
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
  StepFlow: ({
    children,
    footer,
    current,
    onNavigate,
  }: {
    children: ReactNode;
    footer?: ReactNode;
    current: number;
    onNavigate?: (index: number) => void;
  }) => (
    <div>
      {current > REPORT_STEP_INDEX && (
        <button
          type="button"
          onClick={() => onNavigate?.(REPORT_STEP_INDEX)}
        >
          Report step
        </button>
      )}
      {children}
      {footer}
    </div>
  ),
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
  useGhgStatementsForFacility: () => useQuery({
    queryKey: GHG_LIST_QUERY_KEY, queryFn: state.list,
  }, state.client!),
  useGhgStatementState: () => useQuery({
    queryKey: ["ghg-detail"], queryFn: state.detail,
  }, state.client!),
  useFacilityCertifierSummary: () => ({
    data: { mapping: {}, linkedFacilityCount: 1, viewerCanManage: true },
    isError: state.summaryError, isLoading: false,
  }),
  useSyncGhgStatementsFromRegistry: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRefreshGhgStatementStatus: () => ({ isPending: false, mutate: vi.fn() }),
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
    reset: () => {
      state.submitError = null;
      state.submitSuccess = false;
      state.submitData = null;
    },
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
    data:
      state.breakdownStatus === "available"
        ? {
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
            message: state.breakdownMessage,
          }
        : {
            status: "unavailable",
            message: state.breakdownMessage,
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
function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .find((button) => button.props.children === label);
}

async function prepareAndReview(renderer: ReactTestRenderer) {
  await act(async () => findButton(renderer, "Next")?.props.onClick());
  const review = renderer.root
    .findAllByType("a")
    .find((link) => link.props.children === "Review report");
  expect(review).toBeDefined();
  await act(async () => review?.props.onClick());
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  state.client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } },
  });
  state.client.setQueryData(GHG_LIST_QUERY_KEY, []);
  state.list.mockReset().mockResolvedValue([]);
  state.detail.mockReset();
  state.summaryError = false;
  state.create.mockReset();
  state.create.mockResolvedValue({
    externalId: "statement-1",
    linkedRemovalIds: ["removal-1"],
    outcome: "created",
    warnings: [],
  });
  state.refresh.mockReset();
  state.submit.mockReset();
  state.submit.mockResolvedValue({ remoteStatus: "AWAITING_VERIFICATION" });
  state.prepareReport.mockReset();
  state.prepareReport.mockResolvedValue({
    id: "report-1",
    version: 1,
    lifecycle: "prepared",
    reviewUrl: "/api/documents/report-1",
  });
  state.approveReport.mockReset();
  state.approveReport.mockResolvedValue({
    id: "report-1",
    version: 1,
    lifecycle: "approved",
    reviewUrl: "/api/documents/report-1",
  });
  state.breakdownStatus = "available";
  state.breakdownMessage = "Exact registry roll-up available.";
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

    expect(findButton(renderer!, "Generate report")).toBeUndefined();
    expect(findButton(renderer!, "Approve report")).toBeUndefined();

    await act(async () => findButton(renderer!, "Next")?.props.onClick());
    expect(renderer!.root.findByProps({ id: "report-preview" })).toBeDefined();
    expect(state.prepareReport).toHaveBeenCalledOnce();
    const approveAndSubmit = findButton(renderer!, "Approve and submit");
    expect(approveAndSubmit?.props.disabled).toBe(true);
    const review = renderer!.root
      .findAllByType("a")
      .find((link) => link.props.children === "Review report");
    await act(async () => review?.props.onClick());
    expect(findButton(renderer!, "Approve and submit")?.props.disabled).toBe(
      false,
    );
    await act(async () => renderer?.root.findByType("form").props.onSubmit());

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

  it("submits an external report URL without preparing a report", async () => {
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

    const sourceOptions = renderer!.root.findAllByProps({
      name: "reportSource",
    });
    await act(async () => sourceOptions[1].props.onChange());
    await act(async () => findButton(renderer!, "Next")?.props.onClick());
    await act(async () => renderer?.root.findByType("form").props.onSubmit());

    expect(state.prepareReport).not.toHaveBeenCalled();
    expect(state.approveReport).not.toHaveBeenCalled();
    expect(state.submit.mock.calls[0]?.[0]).toMatchObject({
      input: { externalReportUrl: "https://example.com/report.pdf" },
    });
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

    await prepareAndReview(renderer!);

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
    expect(state.prepareReport).toHaveBeenCalledOnce();
    expect(state.approveReport).toHaveBeenCalledOnce();
    expect(findButton(renderer!, "Approve and submit")).toBeUndefined();
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

  it("reuses the reviewed report identity after a failed submission", async () => {
    state.submit
      .mockRejectedValueOnce(new Error("Registry request failed."))
      .mockResolvedValue({ remoteStatus: "AWAITING_VERIFICATION" });

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

    await prepareAndReview(renderer!);
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

    await act(async () =>
      findButton(renderer!, "Review submission")?.props.onClick(),
    );
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
    await act(async () => renderer?.root.findByType("form").props.onSubmit());

    expect(state.prepareReport).toHaveBeenCalledOnce();
    expect(state.approveReport).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledTimes(2);
    await act(async () => renderer?.unmount());
  });

  it("reconciles an approval response loss before submitting", async () => {
    state.prepareReport
      .mockResolvedValueOnce({
        id: "report-1",
        version: 1,
        lifecycle: "prepared",
        reviewUrl: "/api/documents/report-1",
      })
      .mockResolvedValueOnce({
        id: "report-1",
        version: 1,
        lifecycle: "approved",
        reviewUrl: "/api/documents/report-1",
      });
    state.approveReport.mockRejectedValueOnce(
      new Error("Approval response was lost."),
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

    await prepareAndReview(renderer!);
    await act(async () => renderer?.root.findByType("form").props.onSubmit());

    expect(state.prepareReport).toHaveBeenCalledTimes(2);
    expect(state.prepareReport.mock.calls[1]?.[0]).toEqual(
      state.prepareReport.mock.calls[0]?.[0],
    );
    expect(state.submit.mock.calls[0]?.[0]).toMatchObject({
      input: { reportId: "report-1" },
    });
    await act(async () => renderer?.unmount());
  });

  it.each(["Back", "Report step"])(
    "uses a new preparation key after returning with %s",
    async (returnAction) => {
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

    await prepareAndReview(renderer!);
    await act(async () =>
      findButton(renderer!, returnAction)?.props.onClick(),
    );
    await act(async () => findButton(renderer!, "Next")?.props.onClick());

    expect(state.prepareReport).toHaveBeenCalledTimes(2);
    expect(state.prepareReport.mock.calls[1]?.[0].preparationKey).not.toBe(
      state.prepareReport.mock.calls[0]?.[0].preparationKey,
    );
    await act(async () => renderer?.unmount());
    },
  );

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

  it("keeps generated submissions on the report step until generation is ready", async () => {
    const warning = "The registry roll-up is still loading.";
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
          generationUnavailableReason={warning}
        />,
      );
    });

    const next = findButton(renderer!, "Next");
    expect(next?.props.disabled).toBe(true);
    expect(
      renderer!.root.findAllByType("p").some((node) =>
        String(node.props.children).includes(warning),
      ),
    ).toBe(true);
    expect(renderer!.root.findAllByProps({ id: "report-preview" })).toHaveLength(
      0,
    );
    await act(async () => renderer?.unmount());
  });

  it("explains an unavailable breakdown before report review", async () => {
    state.breakdownStatus = "unavailable";
    state.breakdownMessage = "The registry statement total is not available yet.";
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

    expect(findButton(renderer!, "Next")?.props.disabled).toBe(true);
    expect(
      renderer!.root.findAllByType("p").some((node) =>
        String(node.props.children).includes(state.breakdownMessage),
      ),
    ).toBe(true);
    expect(state.prepareReport).not.toHaveBeenCalled();
    await act(async () => renderer?.unmount());
  });

  it("shows report preparation errors on the report step", async () => {
    state.prepareReport.mockRejectedValue(
      new Error("The controlled report could not be prepared."),
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

    await act(async () => findButton(renderer!, "Next")?.props.onClick());
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

    expect(
      renderer!.root.findAllByType("div").some((node) =>
        String(node.props.children).includes(
          "The controlled report could not be prepared.",
        ),
      ),
    ).toBe(true);
    expect(renderer!.root.findAllByProps({ id: "report-preview" })).toHaveLength(
      0,
    );
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
    await act(async () =>
      renderer?.root.findByType("form").props.onSubmit({
        preventDefault: vi.fn(),
      }),
    );
    expect(state.submit).not.toHaveBeenCalled();
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

    await prepareAndReview(renderer!);
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

      await prepareAndReview(renderer!);
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

    await prepareAndReview(renderer!);
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


describe("GHG Statement parent list refreshes", () => {
  const listItem = {
    statement: {
      id: "statement-1", facilityId: "facility-1",
      reportingPeriodStartOn: "2026-07-01",
    },
    effectiveReportingPeriodEndOn: "2026-07-31",
    latestSubmission: null, linkedRemovalCount: 1,
  };
  const detail = {
    statementSubmission: { id: "submission-1", externalId: "registry-1", status: "submitted" },
    statementSubmissionForStatus: null,
    linkedRemovals: [], recentSyncEvents: [],
    remote: { status: "DRAFT", ghg_entry_ids: ["entry-1"], pending_total_co2e_removed_kg: 100 },
  };

  it("retains the selected detail and completed submission after a failed list refetch", async () => {
    state.submit.mockResolvedValue({ remoteStatus: "AWAITING_VERIFICATION" });
    state.client!.setQueryData(GHG_LIST_QUERY_KEY, [listItem]);
    state.list.mockResolvedValue([listItem]);
    state.detail.mockResolvedValue(detail);
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<GhgStatementsList />); });
    await act(async () => {
      await vi.waitFor(() => expect(findButton(renderer!, "Open statement")).toBeDefined());
    });
    await act(async () => findButton(renderer!, "Open statement")!.props.onClick());
    await act(async () => {
      await vi.waitFor(() => expect(findButton(renderer!, "Submit")).toBeDefined());
    });
    await act(async () => findButton(renderer!, "Submit")!.props.onClick());
    await prepareAndReview(renderer!);
    await act(async () => renderer!.root.findByType("form").props.onSubmit());
    await act(async () => renderer!.update(<GhgStatementsList />));
    expect(state.submit).toHaveBeenCalledOnce();
    expect(findButton(renderer!, "Done")).toBeDefined();

    state.list.mockRejectedValue(new Error("List refresh failed"));
    state.detail.mockRejectedValue(new Error("Detail refresh failed"));
    state.summaryError = true;
    await act(async () => {
      await state.client!.invalidateQueries();
    });
    await act(async () => {
      await vi.waitFor(() => expect(findButton(renderer!, "Retry")).toBeDefined());
    });
    expect(renderer!.root.findByType(GhgStatementDetailSheet).props.item.statement.id).toBe("statement-1");
    expect(JSON.stringify(renderer!.toJSON())).toContain("GHG Statement submitted");
    expect(JSON.stringify(renderer!.toJSON())).toContain("GHG Statements could not be refreshed.");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Statement details could not be refreshed.");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Isometric project link unavailable.");
    expect(findButton(renderer!, "Done")).toBeDefined();
    expect(findButton(renderer!, "Submit")).toBeUndefined();
    expect(findButton(renderer!, "Generate new version")).toBeUndefined();
    expect(renderer!.root.findByType(GhgStatementSubmitDialog).props.canSubmit).toBe(false);
    expect(renderer!.root.findByType(GhgStatementSubmitDialog).props.canGenerate).toBe(false);
    expect(renderer!.root.findAllByType("button").find((button) =>
      button.children.includes("New GHG Statement"),
    )?.props.disabled).toBe(true);

    // Recovery updates the parent without remounting the open result dialog.
    state.list.mockResolvedValue([listItem]);
    await act(async () => findButton(renderer!, "Retry")!.props.onClick());
    await act(async () => {
      await vi.waitFor(() => expect(findButton(renderer!, "Retry")).toBeUndefined());
    });
    expect(findButton(renderer!, "Done")).toBeDefined();
    expect(state.submit).toHaveBeenCalledOnce();
    await act(async () => findButton(renderer!, "Done")!.props.onClick());
    expect(renderer!.root.findAllByType("form")).toHaveLength(0);
    expect(renderer!.root.findByType(GhgStatementDetailSheet)).toBeDefined();
    await act(async () => renderer!.unmount());
  });

  it("shows the initial-load error when no cached list exists", async () => {
    state.client!.removeQueries();
    state.list.mockRejectedValue(new Error("Initial load failed"));
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<GhgStatementsList />); });
    await act(async () => {
      await vi.waitFor(() => expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(1));
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain("GHG Statements could not be loaded.");
    expect(renderer!.root.findAllByType(GhgStatementDetailSheet)).toHaveLength(0);
    expect(findButton(renderer!, "Retry")).toBeUndefined();
    await act(async () => renderer!.unmount());
  });

  it("retains an empty cached list after a failed background refetch", async () => {
    state.client!.setQueryData(GHG_LIST_QUERY_KEY, []);
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<GhgStatementsList />); });
    state.list.mockRejectedValue(new Error("List refresh failed"));
    await act(async () => { await state.client!.invalidateQueries(); });
    await act(async () => {
      await vi.waitFor(() => expect(findButton(renderer!, "Retry")).toBeDefined());
    });
    expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(renderer!.root.findByProps({ "data-testid": "statement-list" })).toBeDefined();
    await act(async () => renderer!.unmount());
  });
});
