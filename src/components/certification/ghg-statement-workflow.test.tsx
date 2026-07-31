import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GhgStatementWorkflow,
  startAutomaticFirstReportGeneration,
  shouldAutoGenerateFirstReport,
} from "./ghg-statement-workflow";

const prepareMutation = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
};
const approveMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
};

vi.mock("@/hooks/use-certification", () => ({
  usePrepareGhgStatementReport: () => prepareMutation,
  useApproveGhgStatementReport: () => approveMutation,
  useGhgStatementReports: vi.fn(),
}));

function reportsQuery(data: unknown[]) {
  return {
    isLoading: false,
    error: null,
    data,
  } as never;
}

function failedReportsQuery() {
  return {
    isLoading: false,
    error: new Error("unavailable"),
    data: undefined,
  } as never;
}

describe("GhgStatementWorkflow", () => {
  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    prepareMutation.mutateAsync.mockReset();
    prepareMutation.mutate.mockReset();
    approveMutation.mutateAsync.mockReset();
  });

  it("renders all four steps with one-click generation and no narrative fields", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />,
    );

    expect(html).toContain("Created in registry");
    expect(html).toContain("Report generated");
    expect(html).toContain("Report approved");
    expect(html).toContain("Submitted to verifier");
    expect(html).toContain("Generate report");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="checkbox"');
  });

  it("keeps review and approval explicit for a prepared version", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 2,
            lifecycle: "prepared",
            reviewUrl: "/api/documents/report",
          },
        ])}
      />,
    );

    expect(html).toContain("Generate new version");
    expect(html).toContain("Review");
    expect(html).toContain("Approve");
    expect(html).toContain("Review version 2, then approve it.");
  });

  it("withholds generation until the live statement has entries", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        canGenerate={false}
        generationUnavailableReason="Submit a Removal in this reporting period before generating a report."
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />,
    );

    expect(html).not.toContain("Generate report");
    expect(html).toContain(
      "Submit a Removal in this reporting period before generating a report.",
    );
  });

  it("surfaces the verifier step detail next to the step", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        verifierStep={{
          status: "met",
          detail: "In verification. No action is needed.",
        }}
        reportsQuery={reportsQuery([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 1,
            lifecycle: "submitted",
            reviewUrl: "/api/documents/report",
          },
        ])}
      />,
    );

    expect(html).toContain("In verification. No action is needed.");
    expect(html).toContain("Version 1 approved.");
  });

  it("keeps all four steps visible when reports cannot be loaded", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        verifierStep={{ status: "skipped" }}
        reportsQuery={failedReportsQuery()}
      />,
    );

    expect(html).toContain("Created in registry");
    expect(html).toContain("Report generated");
    expect(html).toContain("Report approved");
    expect(html).toContain("Submitted to verifier");
    expect(html).toContain(
      "Reports could not be loaded. Refresh the page and try again.",
    );
    expect(html).not.toContain("Generate report");
  });

  it("renders the inline submit action on the verifier step when submittable", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        verifierStep={{
          status: "active",
          detail: "Submit the approved report to the verifier.",
        }}
        onSubmit={() => undefined}
        submitLabel="Submit"
        reportsQuery={reportsQuery([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 1,
            lifecycle: "approved",
            reviewUrl: "/api/documents/report",
          },
        ])}
      />,
    );

    expect(html).toContain("Submit the approved report to the verifier.");
    expect(html).toContain(">Submit<");
  });

  it("collapses older report versions behind a disclosure", () => {
    const html = renderToStaticMarkup(
      <GhgStatementWorkflow
        ghgStatementId="11111111-1111-4111-8111-111111111111"
        created
        canManageReports
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([
          {
            id: "22222222-2222-4222-8222-222222222222",
            version: 2,
            lifecycle: "prepared",
            reviewUrl: "/api/documents/report-2",
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            version: 1,
            lifecycle: "approved",
            reviewUrl: "/api/documents/report-1",
          },
        ])}
      />,
    );

    expect(html).toContain("All report versions (2)");
    expect(html).toContain("<details");
  });

  it("auto-generates only for managing viewers with a ready live roll-up", () => {
    const eligible = {
      created: true,
      canManageReports: true,
      autoGenerationReady: true,
      reportsLoaded: true,
      reportCount: 0,
    };

    expect(shouldAutoGenerateFirstReport(eligible)).toBe(true);
    expect(
      shouldAutoGenerateFirstReport({
        ...eligible,
        canManageReports: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoGenerateFirstReport({
        ...eligible,
        autoGenerationReady: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoGenerateFirstReport({ ...eligible, reportCount: 1 }),
    ).toBe(false);
  });

  it("starts one idempotent automatic preparation per statement", () => {
    const attemptedFor = { current: null as string | null };
    const onError = vi.fn();
    const statementId = "11111111-1111-4111-8111-111111111111";

    expect(
      startAutomaticFirstReportGeneration({
        shouldStart: true,
        ghgStatementId: statementId,
        attemptedFor,
        mutate: prepareMutation.mutate as never,
        onError,
      }),
    ).toBe(true);
    expect(
      startAutomaticFirstReportGeneration({
        shouldStart: true,
        ghgStatementId: statementId,
        attemptedFor,
        mutate: prepareMutation.mutate as never,
        onError,
      }),
    ).toBe(false);
    expect(prepareMutation.mutate).toHaveBeenCalledTimes(1);
    expect(prepareMutation.mutate).toHaveBeenCalledWith(
      {
        ghgStatementId: statementId,
        preparationKey: statementId,
        ensureFirst: true,
      },
      { onError },
    );
  });

  it("executes the guarded automatic-generation effect exactly once", async () => {
    const statementId = "11111111-1111-4111-8111-111111111111";
    let renderer: ReactTestRenderer | undefined;
    const workflow = (
      <GhgStatementWorkflow
        ghgStatementId={statementId}
        created
        canManageReports
        canGenerate
        autoGenerationReady
        verifierStep={{ status: "skipped" }}
        reportsQuery={reportsQuery([])}
      />
    );

    await act(async () => {
      renderer = create(workflow);
    });
    expect(prepareMutation.mutate).toHaveBeenCalledTimes(1);
    expect(prepareMutation.mutate).toHaveBeenCalledWith(
      {
        ghgStatementId: statementId,
        preparationKey: statementId,
        ensureFirst: true,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    await act(async () => {
      renderer?.update(workflow);
    });
    expect(prepareMutation.mutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
