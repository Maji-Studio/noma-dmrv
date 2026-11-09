// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
const records = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("../removal-records", () => ({
  RemovalRecords: (props: Record<string, unknown>) => {
    records.props = props;
    return <div>Batch records</div>;
  },
}));

import { SourceRecords } from "./source-records";

const STORAGE = "https://registry.sandbox.isometric.com/account/certify/project/prj_1/storage-sites?tab=sites";

afterEach(cleanup);

describe("SourceRecords", () => {
  it("shows the Removal sheet's records per credit batch for this Removal, then the Storage sites link", () => {
    render(<SourceRecords removalId="rm-1" facilityId="facility-1" storageSitesHref={STORAGE} />);
    expect(screen.getByRole("heading", { name: "Records" })).toBeTruthy();
    expect(screen.getByText("Batch records")).toBeTruthy();
    expect(records.props).toMatchObject({ removalId: "rm-1", facilityId: "facility-1", enabled: true, mode: { newTab: true } });
    expect(screen.getByRole("link", { name: "View in Isometric" }).getAttribute("href")).toBe(STORAGE);
  });

  it("leaves the Storage sites row out when the facility is not linked", () => {
    render(<SourceRecords removalId="rm-1" facilityId="facility-1" storageSitesHref={null} />);
    expect(screen.queryByText("Storage sites")).toBeNull();
  });
});
