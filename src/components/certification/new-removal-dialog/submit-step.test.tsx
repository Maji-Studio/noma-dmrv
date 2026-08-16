import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { SubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";
import { SubmitStep } from "./submit-step";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  discardMutate: vi.fn(),
  discardReset: vi.fn(),
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
}));

vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("@/hooks/use-certification", () => ({
  useDiscardRemovalDraft: () => ({
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
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/certification/readiness", () => ({
  buildRemovalRequirementsChecklist: () => [],
  deriveRemovalReadiness: () => ({
    state: "ready",
    reasons: [],
    advisories: [],
  }),
}));

vi.mock("@/lib/certification/readiness-facts", () => ({
  toRemovalReadinessFacts: () => ({}),
}));

vi.mock("./submission-facts", () => ({
  isRemovalCompilationReady: () => true,
}));

vi.mock("./submission-summary", () => ({
  SubmissionSummary: () => <div>Submission summary</div>,
}));

vi.mock("./debug-drawer", () => ({
  DebugDrawer: () => null,
}));

vi.mock("../submit-confirm-dialog", () => ({
  SubmitConfirmDialog: () => null,
}));

vi.mock("../submission-progress", () => ({
  SubmissionProgress: () => <div>Submission progress</div>,
}));

const CONTEXT = {
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

function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .find((button) => button.props.children === label);
}

function findLink(renderer: ReactTestRenderer, label: string) {
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
});

describe("SubmitStep", () => {
  it("discards a local draft only after confirmation", async () => {
    const onDone = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <SubmitStep
          removalId="removal-1"
          facilityId="facility-1"
          facilityName="Tanzania facility"
          ctx={CONTEXT}
          onDone={onDone}
          submitMutation={
            {
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              data: undefined,
              error: null,
              reset: vi.fn(),
            } as never
          }
        />,
      );
    });

    await act(async () => {
      findButton(renderer!, "Discard draft")?.props.onClick();
    });
    expect(state.discardMutate).not.toHaveBeenCalled();

    await act(async () => {
      findButton(renderer!, "Confirm discard")?.props.onClick();
    });
    expect(state.discardMutate).toHaveBeenCalledWith(
      { facilityId: "facility-1", removalId: "removal-1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    const options = state.discardMutate.mock.calls[0]?.[1] as {
      onSuccess: () => void;
    };
    await act(async () => options.onSuccess());
    expect(state.toastSuccess).toHaveBeenCalledWith(
      "Removal draft discarded. Credit batches are available again.",
    );
    expect(onDone).toHaveBeenCalledOnce();

    await act(async () => renderer?.unmount());
  });

  it("does not offer discard after submission history exists", async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <SubmitStep
          removalId="removal-1"
          facilityId="facility-1"
          facilityName="Tanzania facility"
          ctx={
            {
              ...CONTEXT,
              latestSubmission: { status: "draft" },
            } as RemovalCertifyContext
          }
          onDone={vi.fn()}
          submitMutation={
            {
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              data: undefined,
              error: null,
              reset: vi.fn(),
            } as never
          }
        />,
      );
    });

    expect(findButton(renderer!, "Discard draft")).toBeUndefined();
    await act(async () => renderer?.unmount());
  });

  it("refreshes the route after success without closing the dialog", async () => {
    const mutate = vi.fn();
    const onDone = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <SubmitStep
          removalId="removal-1"
          facilityId="facility-1"
          facilityName="Tanzania facility"
          ctx={CONTEXT}
          onDone={onDone}
          submitMutation={
            {
              mutate,
              isPending: false,
              isSuccess: false,
              data: undefined,
              error: null,
              reset: vi.fn(),
            } as never
          }
        />,
      );
    });

    await act(async () => {
      findButton(renderer!, "Submit Removal")?.props.onClick();
    });

    const options = mutate.mock.calls[0]?.[1] as {
      onSuccess: (result: { externalId: string; version: number }) => void;
    };
    await act(async () => {
      options.onSuccess({ externalId: "removal-external-1", version: 1 });
    });

    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.toastSuccess).toHaveBeenCalledWith(
      "Removal removal-external-1 submitted.",
    );
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it("keeps the success message visible until Done is selected", async () => {
    const onDone = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <SubmitStep
          removalId="removal-1"
          facilityId="facility-1"
          facilityName="Tanzania facility"
          ctx={CONTEXT}
          onDone={onDone}
          submitMutation={
            {
              mutate: vi.fn(),
              isPending: false,
              isSuccess: true,
              data: { externalId: "removal-external-1", version: 1 },
              error: null,
              reset: vi.fn(),
            } as never
          }
        />,
      );
    });

    expect(renderer?.root.findByProps({ children: "Removal submitted to the registry." })).toBeDefined();
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      findButton(renderer!, "Done")?.props.onClick();
    });
    expect(onDone).toHaveBeenCalledOnce();

    await act(async () => {
      renderer?.unmount();
    });
  });

  async function renderSuccessfulSubmit(ctx: RemovalCertifyContext) {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <SubmitStep
          removalId="removal-1"
          facilityId="facility-1"
          facilityName="Tanzania facility"
          ctx={ctx}
          onDone={vi.fn()}
          submitMutation={
            {
              mutate: vi.fn(),
              isPending: false,
              isSuccess: true,
              data: { externalId: "rmv_1KT958C1JSBXF5F8", version: 1 },
              error: null,
              reset: vi.fn(),
            } as never
          }
        />,
      );
    });

    return renderer!;
  }

  it("links to the sandbox removal without a storage sites CTA", async () => {
    const renderer = await renderSuccessfulSubmit({
      ...CONTEXT,
      mapping: {
        externalProjectId: "prj_1K9YJ33RKSBX9FFF",
      },
    } as unknown as RemovalCertifyContext);

    expect(findLink(renderer!, "View storage sites")).toBeUndefined();
    expect(findLink(renderer!, "View on Isometric")?.props.href).toBe(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/ghg-entry/rmv_1KT958C1JSBXF5F8/edit",
    );

    await act(async () => {
      renderer?.unmount();
    });
  });

  it("uses production links after submission", async () => {
    const renderer = await renderSuccessfulSubmit({
      ...CONTEXT,
      isProduction: true,
      mapping: {
        externalProjectId: "prj_1K9YJ33RKSBX9FFF",
      },
    } as unknown as RemovalCertifyContext);

    expect(findLink(renderer!, "View storage sites")).toBeUndefined();
    expect(findLink(renderer!, "View on Isometric")?.props.href).toBe(
      "https://registry.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/ghg-entry/rmv_1KT958C1JSBXF5F8/edit",
    );

    await act(async () => {
      renderer?.unmount();
    });
  });

  it("omits registry actions after submission without a project mapping", async () => {
    const renderer = await renderSuccessfulSubmit(CONTEXT);

    expect(findLink(renderer!, "View storage sites")).toBeUndefined();
    expect(findLink(renderer!, "View on Isometric")).toBeUndefined();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it("offers direct retry when the server fails before progress starts", async () => {
    const mutate = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <SubmitStep
          removalId="removal-1"
          facilityId="facility-1"
          facilityName="Tanzania facility"
          ctx={CONTEXT}
          onDone={vi.fn()}
          submitMutation={
            {
              mutate,
              isPending: false,
              isSuccess: false,
              isError: true,
              data: undefined,
              error: new Error("Server submission failed"),
              reset: vi.fn(),
            } as never
          }
        />,
      );
    });

    expect(findButton(renderer!, "Try again")).toBeDefined();
    await act(async () => {
      findButton(renderer!, "Try again")?.props.onClick();
    });
    expect(mutate).toHaveBeenCalledOnce();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it("keeps a possibly-live stalled request close-only", async () => {
    const mutate = vi.fn();
    const onDone = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <SubmitStep
          removalId="removal-1"
          facilityId="facility-1"
          facilityName="Tanzania facility"
          ctx={CONTEXT}
          onDone={onDone}
          submitMutation={
            {
              mutate,
              isPending: false,
              isSuccess: false,
              isError: true,
              data: undefined,
              error: new SubmissionStreamStalledError(),
              reset: vi.fn(),
            } as never
          }
        />,
      );
    });

    expect(findButton(renderer!, "Try again")).toBeUndefined();
    expect(findButton(renderer!, "Close")).toBeDefined();
    await act(async () => {
      findButton(renderer!, "Close")?.props.onClick();
    });
    expect(onDone).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });
});
