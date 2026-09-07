import { zodResolver } from "@hookform/resolvers/zod";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useForm } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSubmitGhgStatementDialogSchema,
  type SubmitGhgStatementDialogFormInput,
} from "@/schemas/certification";

function ValidationHarness({
  isProduction,
  isResubmit,
  defaultValues,
  onValidated,
}: {
  isProduction: boolean;
  isResubmit: boolean;
  defaultValues: SubmitGhgStatementDialogFormInput;
  onValidated: (input: SubmitGhgStatementDialogFormInput) => void;
}) {
  const form = useForm<SubmitGhgStatementDialogFormInput>({
    resolver: zodResolver(
      buildSubmitGhgStatementDialogSchema({ isProduction, isResubmit }),
    ),
    defaultValues,
  });

  return <form onSubmit={form.handleSubmit(onValidated)} />;
}

async function submit(renderer: ReactTestRenderer) {
  await act(async () =>
    renderer.root.findByType("form").props.onSubmit({
      preventDefault: vi.fn(),
      persist: vi.fn(),
    }),
  );
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("GHG Statement submit validation", () => {
  it.each([
    {
      name: "production confirmation",
      isProduction: true,
      isResubmit: false,
      defaultValues: {
        reportSource: "generated" as const,
        confirmProduction: false,
      },
    },
    {
      name: "resubmission summary",
      isProduction: false,
      isResubmit: true,
      defaultValues: {
        reportSource: "generated" as const,
        summaryOfChanges: "",
      },
    },
  ])("blocks preparation until $name validates", async (testCase) => {
    const prepareReport = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ValidationHarness
          isProduction={testCase.isProduction}
          isResubmit={testCase.isResubmit}
          defaultValues={testCase.defaultValues}
          onValidated={prepareReport}
        />,
      );
    });

    await submit(renderer!);

    expect(prepareReport).not.toHaveBeenCalled();
    await act(async () => renderer?.unmount());
  });

  it("runs preparation after production and resubmission fields validate", async () => {
    const prepareReport = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <ValidationHarness
          isProduction
          isResubmit
          defaultValues={{
            reportSource: "generated",
            confirmProduction: true,
            summaryOfChanges: "Corrected the reporting period.",
          }}
          onValidated={prepareReport}
        />,
      );
    });

    await submit(renderer!);

    expect(prepareReport).toHaveBeenCalledOnce();
    await act(async () => renderer?.unmount());
  });
});
