// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

import { SourceRecords } from "./source-records";

const LEDGER = {
  creditBatches: [{ id: "b1", code: "CB-26-001" }],
  productionRuns: [{ id: "r1", code: "PR-26-001" }],
  applications: [{ id: "a1", code: "AP-26-001", deliveryCode: "DL-26-001", creditBatchIds: ["b1"] }],
};
const STORAGE = "https://registry.sandbox.isometric.com/account/certify/project/prj_1/storage-sites?tab=sites";

afterEach(cleanup);

describe("SourceRecords", () => {
  it("puts the Storage sites link first, then the runs and applications, under a count summary", () => {
    render(<SourceRecords ledger={LEDGER} facilityId="facility-1" storageSitesHref={STORAGE} />);
    fireEvent.click(screen.getByRole("button", { name: /Source records/ }));
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[0].textContent).toContain("Storage sites");
    expect(within(items[0]).getByRole("link", { name: "View in Isometric" }).getAttribute("href")).toBe(STORAGE);
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("PR-26-001"), expect.stringContaining("AP-26-001")]),
    );
    expect(screen.getByText("1 production run, 1 application")).toBeTruthy();
  });

  it("leaves the Storage sites row out when the facility is not linked", () => {
    render(<SourceRecords ledger={LEDGER} facilityId="facility-1" storageSitesHref={null} />);
    expect(screen.queryByText("Storage sites")).toBeNull();
  });
});
