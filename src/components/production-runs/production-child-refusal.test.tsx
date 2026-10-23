// @vitest-environment jsdom
/**
 * A refused incident or in-process measurement save lands at the field the
 * server names (#1327 PR F); the parent tables hand the footer on.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductionIncidentWithRelations } from "@/data-access/production-incidents";
import type { ProductionSampleWithRelations } from "@/data-access/production-samples";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { ActionError } from "@/lib/action-error";

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
}));
vi.mock("@/hooks/use-record-certification-lock", () => ({ useIsRecordCertificationLocked: () => false }));
vi.mock("@/components/forms/entity-select", () => ({ EntitySelect: () => null }));
vi.mock("@/components/forms/form-file-upload", () => ({ FormFileUpload: () => null }));
vi.mock("@/components/forms/event-time-input", () => ({ EventTimeInput: () => null }));

import { ProductionIncidentForm } from "./production-incident-form";
import { ProductionSampleForm } from "./production-sample-form";

afterEach(cleanup);

const refusal = (path: string, message: string) =>
  new ActionError({ error: message, code: "validation_failed", issues: [{ path: [path], code: "validation_failed", message }] });
const FALLBACK = "Not saved. Try again.";

describe("ProductionIncidentForm refused saves", () => {
  it("shows a refusal at the description and leaves the footer empty", async () => {
    const message = "Describe what happened in plain words.";
    const footers: Array<string | null> = [];
    const incident = {
      id: "i1", version: 1, incidentTime: new Date("2026-09-01T12:00:00Z"), severity: "low",
      description: "Saved text", operatorId: null, reactorId: null, correctiveActions: null, notes: null,
    } as unknown as ProductionIncidentWithRelations;
    const onSubmit = vi.fn((_data, onRefusal) => { footers.push(onRefusal(refusal("description", message), FALLBACK)); });
    render(<ProductionIncidentForm productionRunId="11111111-1111-4111-8111-111111111111" facilityId="f1" incident={incident} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(await screen.findAllByText(message)).toHaveLength(1);
    expect(footers).toEqual([null]);
  });
});

describe("ProductionSampleForm refused saves", () => {
  it("shows a refusal at the weight and leaves the footer empty", async () => {
    const message = "Weight must be more than zero.";
    const footers: Array<string | null> = [];
    const sample = {
      id: "s1", version: 1, timestamp: new Date("2026-09-01T12:00:00Z"), weightGrams: 120,
    } as unknown as ProductionSampleWithRelations;
    const deferred = { attachments: [], add: vi.fn(), remove: vi.fn() } as unknown as UseDeferredAttachmentsResult;
    const onSubmit = vi.fn((_data, onRefusal) => { footers.push(onRefusal(refusal("weightGrams", message), FALLBACK)); });
    render(
      <ProductionSampleForm
        productionRunId="11111111-1111-4111-8111-111111111111" facilityId="f1" sample={sample} onSubmit={onSubmit}
        deferredAttachments={deferred} onRetryDeferredAttachment={vi.fn()} onRemoveDeferredAttachment={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(await screen.findAllByText(message)).toHaveLength(1);
    expect(footers).toEqual([null]);
  });
});
