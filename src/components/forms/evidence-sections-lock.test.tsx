// @vitest-environment jsdom
/**
 * Edit-mode evidence sections on a certification-locked record keep their
 * failed queued uploads listed but offer no retry. Uses the real
 * FailedDeferredAttachments with failed rows.
 */
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Delivery } from "@/db/schema";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { SampleWithRelations } from "@/data-access/samples";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";

const mocks = vi.hoisted(() => ({ locked: false, lockArgs: [] as unknown[][] }));

vi.mock("@/hooks/use-record-certification-lock", () => ({
  useIsRecordCertificationLocked: (...args: unknown[]) => {
    mocks.lockArgs.push(args);
    return mocks.locked;
  },
}));
vi.mock("@/components/forms", () => ({
  FormSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  FormField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  FormFileUpload: () => <div data-testid="uploader" />,
}));
vi.mock("@/components/transport-legs", () => ({
  ClassifiedTransportEvidenceUploader: () => <div data-testid="uploader" />,
  TransportEvidencePanel: () => <div data-testid="evidence-panel" />,
  TransportLegsEditor: () => null,
}));
vi.mock("@/components/samples/sample-documents-panel", () => ({
  SampleDocumentsPanel: () => <div data-testid="evidence-panel" />,
}));
vi.mock("@/components/ui/actionable-focus-target", () => ({
  ActionableFocusTarget: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { DeliveryEvidenceSection } from "@/components/deliveries/delivery-trailing-sections";
import { FeedstockEvidenceSection } from "@/components/feedstocks/feedstock-trailing-sections";
import { SampleEvidenceSection } from "@/components/samples/sample-trailing-sections";

afterEach(cleanup);

function failedAttachments(): UseDeferredAttachmentsResult {
  return {
    attachments: [{ key: "a1", file: new File(["x"], "receipt.pdf"), documentType: "pdf", status: "failed", error: "Upload failed." }],
    retry: vi.fn(),
    remove: vi.fn(),
  } as unknown as UseDeferredAttachmentsResult;
}

const SECTIONS = [
  ["delivery", () => <DeliveryEvidenceSection delivery={{ id: "record-1" } as Delivery} isEditMode deferredAttachments={failedAttachments()} />],
  ["feedstock", () => <FeedstockEvidenceSection feedstock={{ id: "record-1" } as FeedstockWithRelations} isEditMode deferredAttachments={failedAttachments()} />],
  ["sample", () => <SampleEvidenceSection sample={{ id: "record-1" } as SampleWithRelations} isEditMode deferredAttachments={failedAttachments()} />],
] as const;

describe("evidence sections on a locked record", () => {
  beforeEach(() => {
    mocks.locked = false;
    mocks.lockArgs = [];
  });

  it.each(SECTIONS)("keeps a locked %s's failed uploads listed without retry", (entityType, renderSection) => {
    mocks.locked = true;
    render(renderSection());

    expect(mocks.lockArgs).toContainEqual([entityType, "record-1"]);
    expect(screen.getByText("1 attachment was not uploaded")).toBeTruthy();
    expect(screen.getByText("receipt.pdf")).toBeTruthy();
    expect(screen.getByText("Upload failed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove receipt.pdf" })).toBeTruthy();
  });

  it.each(SECTIONS)("offers retries on an unlocked %s", (_entityType, renderSection) => {
    render(renderSection());

    expect(screen.getByRole("button", { name: "Retry uploads" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
