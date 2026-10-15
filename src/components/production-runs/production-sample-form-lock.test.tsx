// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionSampleWithRelations } from "@/data-access/production-samples";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { RECORD_FILES_LOCKED_MESSAGE } from "@/lib/certification/lineage-lock-message";

const mocks = vi.hoisted(() => ({ locked: false, lockArgs: [] as unknown[][] }));

vi.mock("@/hooks/use-record-certification-lock", () => ({
  useIsRecordCertificationLocked: (...args: unknown[]) => {
    mocks.lockArgs.push(args);
    return mocks.locked;
  },
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
}));
vi.mock("@/components/forms", () => ({
  FormSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  FormField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  FormFileUpload: () => <div data-testid="uploader" />,
  FormInput: () => null,
  FormActions: () => null,
  MoistureField: () => null,
}));
vi.mock("@/components/forms/resolved-error-revalidator", () => ({ ResolvedErrorRevalidator: () => null }));
vi.mock("@/components/forms/event-time-input", () => ({ EventTimeInput: () => null }));
vi.mock("@/components/forms/entity-select", () => ({ EntitySelect: () => null }));
vi.mock("@/components/forms/form-textarea", () => ({ FormTextarea: () => null }));

import { ProductionSampleForm } from "./production-sample-form";

afterEach(cleanup);

const SAMPLE = { id: "measurement-1", timestamp: new Date("2026-06-01T00:00:00Z") } as unknown as ProductionSampleWithRelations;

function renderForm() {
  const deferredAttachments = {
    attachments: [{ key: "a1", file: new File(["x"], "photo.jpg"), documentType: "lab_report", status: "failed", error: "Upload failed." }],
    add: vi.fn(),
    remove: vi.fn(),
  } as unknown as UseDeferredAttachmentsResult;
  return render(
    <ProductionSampleForm
      productionRunId="run-1"
      facilityId="facility-1"
      sample={SAMPLE}
      onSubmit={vi.fn()}
      deferredAttachments={deferredAttachments}
      onRetryDeferredAttachment={vi.fn()}
      onRemoveDeferredAttachment={vi.fn()}
    />,
  );
}

describe("ProductionSampleForm certification lock", () => {
  beforeEach(() => {
    mocks.locked = false;
    mocks.lockArgs = [];
  });

  it("hides upload and retry controls on a saved measurement whose run is submitted", () => {
    mocks.locked = true;
    renderForm();

    expect(mocks.lockArgs).toContainEqual(["production_sample", "measurement-1"]);
    expect(screen.getByText(RECORD_FILES_LOCKED_MESSAGE)).toBeTruthy();
    expect(screen.queryByTestId("uploader")).toBeNull();
    expect(screen.getByText("photo.jpg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("is unchanged while the measurement is not locked", () => {
    renderForm();

    expect(screen.queryByText(RECORD_FILES_LOCKED_MESSAGE)).toBeNull();
    expect(screen.getByTestId("uploader")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry uploads" })).toBeTruthy();
  });
});
