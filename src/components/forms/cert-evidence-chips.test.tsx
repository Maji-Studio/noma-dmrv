// @vitest-environment jsdom
/**
 * CERT chips on the evidence sections and distance fields of Delivery,
 * Feedstock and Sample, in edit and read mode (issue #1430).
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailField } from "@/components/ui/detail-panel";
import type { Delivery } from "@/db/schema";
import type { DeliveryWithRelations } from "@/data-access/deliveries";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { SampleWithRelations } from "@/data-access/samples";

const mocks = vi.hoisted(() => ({ status: "neutral" as string, lastEntityId: undefined as string | undefined }));

vi.mock("@/components/forms/use-documents-cert-status", () => ({
  useDocumentsCertStatus: (_type: string, entityId: string | undefined) => {
    mocks.lastEntityId = entityId;
    return mocks.status;
  },
}));
vi.mock("@/hooks/use-record-certification-lock", () => ({ useIsRecordCertificationLocked: () => false }));
vi.mock("@/components/forms", () => ({
  FormSection: ({ title, certifyRequired, certifyStatus, children }: { title: string; certifyRequired?: boolean; certifyStatus?: string; children?: ReactNode }) => (
    <section aria-label={title} data-cert={certifyRequired ? "on" : "off"} data-status={certifyStatus}>{children}</section>
  ),
  FormField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  FormFileUpload: () => null,
}));
vi.mock("@/components/transport-legs", () => ({
  ClassifiedTransportEvidenceUploader: () => null,
  TransportEvidencePanel: () => null,
  TransportRoutePreview: () => null,
  TransportLegsSummary: () => null,
  TransportLegsEditor: () => null,
}));
vi.mock("@/components/samples/sample-documents-panel", () => ({ SampleDocumentsPanel: () => null }));
vi.mock("@/components/ui/actionable-focus-target", () => ({
  ActionableFocusTarget: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/deliveries/delivery-stock-details", () => ({ DeliveryStockDetails: () => null }));

import { DeliveryEvidenceSection } from "@/components/deliveries/delivery-trailing-sections";
import { deliverySheetSections } from "@/components/deliveries/delivery-read-sections";
import { feedstockSheetSections } from "@/components/feedstocks/feedstock-read-sections";
import { SampleEvidenceSection } from "@/components/samples/sample-trailing-sections";
import { sampleSheetSections } from "@/components/samples/sample-read-sections";

afterEach(() => {
  cleanup();
  mocks.status = "neutral";
  mocks.lastEntityId = undefined;
});

const chip = (field: Parameters<typeof DetailField>[0]) =>
  renderToStaticMarkup(<DetailField {...field} />).match(/data-cert-field="(\w+)"/)?.[1] ?? null;

describe("edit mode evidence sections", () => {
  it.each(["neutral", "missing", "satisfied"])("Delivery evidence carries CERT with the %s status", (status) => {
    mocks.status = status;
    render(<DeliveryEvidenceSection isEditMode delivery={{ id: "d1" } as Delivery} />);
    const section = screen.getByLabelText("Delivery evidence");
    expect(section.dataset.cert).toBe("on");
    expect(section.dataset.status).toBe(status);
    expect(mocks.lastEntityId).toBe("d1");
  });

  it("Delivery evidence reads no saved files while creating", () => {
    render(<DeliveryEvidenceSection isEditMode={false} />);
    expect(mocks.lastEntityId).toBeUndefined();
  });

  it.each(["neutral", "missing", "satisfied"])("Sample Evidence & documents carries CERT with the %s status", (status) => {
    mocks.status = status;
    render(<SampleEvidenceSection isEditMode sample={{ id: "s1", sampling: "sampled" } as SampleWithRelations} />);
    const section = screen.getByLabelText("Evidence & documents");
    expect(section.dataset.cert).toBe("on");
    expect(section.dataset.status).toBe(status);
  });

  it("Sample form shows neither removed copy line", () => {
    render(<SampleEvidenceSection isEditMode sample={{ id: "s1" } as SampleWithRelations} />);
    expect(screen.queryByText(/You can still submit the Removal/)).toBeNull();
  });
});

describe("Delivery read view", () => {
  const delivery = {
    id: "d1", code: "DL-1", status: "delivered", deliveryDate: new Date("2026-09-22T09:00:00Z"), facilityId: "f1",
    distanceKmOverride: null, effectiveDistanceKm: 240, recordedDistanceKm: 240, deliveredWetMassKg: 1000,
  } as unknown as DeliveryWithRelations;
  const sections = (status: "neutral" | "missing" | "satisfied", record = delivery) =>
    deliverySheetSections(record, [{ id: "f1", timezone: "UTC" }], status);

  it("puts CERT on One-way distance, green when a distance is on file, orange when none", () => {
    const field = (record: DeliveryWithRelations) => sections("neutral", record).find((s) => s.title === "Transport")!.fields.find((f) => f.label === "One-way distance")!;
    expect(chip(field(delivery))).toBe("satisfied");
    expect(chip(field({ ...delivery, effectiveDistanceKm: null } as unknown as DeliveryWithRelations))).toBe("missing");
  });

  it("keeps CERT off the Route preview", () => {
    const transport = sections("neutral").find((s) => s.title === "Transport")!;
    const html = JSON.stringify(transport.content, (_key, value) => (typeof value === "function" ? undefined : value));
    expect(html).not.toContain('"certTag":true');
  });

  it.each(["neutral", "missing", "satisfied"] as const)("Delivery evidence carries CERT with the %s status", (status) => {
    const evidence = sections(status).find((s) => s.title === "Delivery evidence")!;
    expect(evidence.certifyRequired).toBe(true);
    expect(evidence.certifyStatus).toBe(status);
  });
});

describe("Feedstock read view", () => {
  const feedstock = { id: "f1", code: "FS-1", distanceKmOverride: null, supplierName: "Supplier" } as unknown as FeedstockWithRelations;
  const sections = (distanceKm: number | null) => feedstockSheetSections(feedstock, { distanceKm, pending: false });

  it("puts CERT on One-way distance: green with a distance, orange without", () => {
    const field = (km: number | null) => sections(km).find((s) => s.title === "Transport details")!.fields.find((f) => f.label === "One-way distance")!;
    expect(chip(field(15))).toBe("satisfied");
    expect(chip(field(null))).toBe("missing");
  });

  it("keeps Transport evidence without CERT", () => {
    const evidence = sections(15).find((s) => s.title === "Transport evidence")!;
    expect(evidence.certifyRequired).toBeUndefined();
  });
});

describe("Sample read view", () => {
  const sample = { id: "s1", sampling: "sampled", creditBatchCode: "CB-1", samplingTime: new Date("2026-09-10T08:00:00Z"), facilityTimezone: "UTC" } as unknown as SampleWithRelations;

  it.each(["neutral", "missing", "satisfied"] as const)("Evidence & documents carries CERT with the %s status", (status) => {
    const evidence = sampleSheetSections(sample, status).find((s) => s.title === "Evidence & documents")!;
    expect(evidence.certifyRequired).toBe(true);
    expect(evidence.certifyStatus).toBe(status);
  });
});
