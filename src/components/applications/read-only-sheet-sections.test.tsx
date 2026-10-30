// @vitest-environment jsdom
/**
 * #1499: a read-only sheet (a link into an archived facility) passes its
 * state into the section builders, so their write actions go away: the
 * distance refresh on feedstock and delivery sheets, and upload, delete and
 * sync on the application sheet.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { ApplicationListItem } from "@/data-access/applications";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { DeliverySheetRecord } from "@/components/deliveries/delivery-read-sections";

vi.mock("@/components/transport-legs/transport-distance-drift", () => ({ TransportDistanceDriftNotice: () => null }));
vi.mock("@/components/applications/application-supporting-evidence-panel", () => ({ ApplicationSupportingEvidencePanel: () => null }));
vi.mock("@/components/applications/application-storage-location-sync", () => ({ ApplicationStorageLocationSync: () => null }));

import { TransportDistanceDriftNotice } from "@/components/transport-legs/transport-distance-drift";
import { ApplicationSupportingEvidencePanel } from "@/components/applications/application-supporting-evidence-panel";
import { ApplicationStorageLocationSync } from "@/components/applications/application-storage-location-sync";
import { feedstockSheetSections } from "@/components/feedstocks/feedstock-read-sections";
import { deliverySheetSections } from "@/components/deliveries/delivery-read-sections";
import { applicationSheetSections } from "./application-read-sections";

/** Every element of `type` anywhere in the sections' content. */
function findElements(sections: DetailPanelSection[], type: unknown): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isValidElement<Record<string, unknown>>(node)) return;
    if (node.type === type) found.push(node);
    walk(node.props.children as ReactNode);
  };
  sections.forEach((section) => walk(section.content));
  return found;
}

const FEEDSTOCK = { id: "fs-1", code: "FS-1", distanceKmOverride: null, supplierName: "Supplier" } as unknown as FeedstockWithRelations;
const DELIVERY = { id: "dl-1", code: "DL-1", facilityId: "f1", deliveryDate: new Date("2026-10-29"), status: "delivered" } as unknown as DeliverySheetRecord;
const APPLICATION = { id: "ap-1", code: "AP-1", applicationDate: new Date("2026-10-29"), evidenceMethod: "location", allocationShares: [] } as unknown as ApplicationListItem;
const LOCK = { data: false, isPending: false, error: null, isFetching: false, refetch: vi.fn() };

describe("read-only sheet sections", () => {
  it.each([false, true])("feedstock distance refresh follows readOnly=%s", (readOnly) => {
    const [notice] = findElements(feedstockSheetSections(FEEDSTOCK, undefined, { readOnly }), TransportDistanceDriftNotice);
    expect(notice.props.readOnly).toBe(readOnly);
  });

  it.each([false, true])("delivery distance refresh follows readOnly=%s", (readOnly) => {
    const [notice] = findElements(deliverySheetSections(DELIVERY, [], "neutral", { readOnly }), TransportDistanceDriftNotice);
    expect(notice.props.readOnly).toBe(readOnly);
  });

  it.each([false, true])("application upload, delete and sync follow readOnly=%s", (readOnly) => {
    const sections = applicationSheetSections(APPLICATION, { delivery: undefined, lock: LOCK, durabilityOption: "1000_year", readOnly });
    expect(findElements(sections, ApplicationSupportingEvidencePanel).map((el) => el.props.readOnly)).toEqual([readOnly]);
    expect(findElements(sections, ApplicationStorageLocationSync).map((el) => el.props.readOnly)).toEqual([readOnly]);
  });

  it("says the archived delivery is loading, not missing", () => {
    const deliveryRead = { isPending: true, error: null, isFetching: true, refetch: vi.fn() };
    const [details] = applicationSheetSections(APPLICATION, { delivery: undefined, deliveryRead, lock: LOCK, durabilityOption: "1000_year", readOnly: true });
    expect(details.fields.find((field) => field.label === "Delivery source")?.value).toBe("Loading the delivery.");
  });

  it("shows a failed archived delivery read with Try again", () => {
    const refetch = vi.fn();
    const deliveryRead = { isPending: false, error: new Error("boom"), isFetching: false, refetch };
    const sections = applicationSheetSections(APPLICATION, { delivery: undefined, deliveryRead, lock: LOCK, durabilityOption: "1000_year", readOnly: true });
    render(<>{sections[0].content}</>);
    expect(screen.getByText("The delivery could not be loaded.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
