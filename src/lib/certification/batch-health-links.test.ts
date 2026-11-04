import { expect, it } from "vitest";
import { batchHealthFixLinkFor, fallbackBatchHealthFixTarget } from "./batch-health-links";

const records = [
  { id: "one", code: "DL-1", missing: ["distance"], href: "/customers?location=one" },
  { id: "two", code: "DL-2", missing: ["distance"], href: "/customers?location=one" },
];

it("uses a location shortcut only when all distance records share it", () => {
  expect(batchHealthFixLinkFor({ key: "transport", fixTarget: "deliveryDistances", affectedRecords: records }, "facility"))
    .toEqual({ label: "Edit location distances", href: records[0].href });
  expect(batchHealthFixLinkFor({ key: "transport", fixTarget: "deliveryDistances",
    affectedRecords: [records[0], { ...records[1], href: "/customers?location=two" }] }, "facility").href)
    .toBe("/deliveries?facility=facility&ids=one%2Ctwo");
});
it("keeps evidence and merged-delivery links even when a record has a location href", () => {
  expect(batchHealthFixLinkFor({ key: "transport", fixTarget: "deliveryEvidence",
    affectedRecords: [records[0]] }, "facility").href).toContain("focus=transport-evidence");
  expect(batchHealthFixLinkFor({ key: "transport", fixTarget: "deliveries",
    affectedRecords: records }, "facility")).toEqual({ label: "Review deliveries", href: "/deliveries?facility=facility" });
});
it("does not label generic hrefs as location repairs", () => {
  expect(batchHealthFixLinkFor({ key: "carbon", affectedRecords: records }, "facility").label).toBe("Fix 2 Samples");
});

it("keeps emissions evidence separate from emission estimates and opens the batch sheet", () => {
  expect(fallbackBatchHealthFixTarget("emissions")).toBe("emissions");
  expect(batchHealthFixLinkFor({ key: "emissions" }, "facility-1", "batch-1")).toEqual({
    label: "Review emissions", href: "/credit-batches/batch-1?facility=facility-1&tab=emissions",
  });
});

it.each(["deliveries", "deliveryEvidence", "deliveryDistances"] as const)("scopes the %s link to its repair destination", (fixTarget) => {
  const affectedRecords = records.map(({ id, code, missing }) => ({ id, code, missing }));
  const link = batchHealthFixLinkFor({ key: "entityReadiness", fixTarget, affectedRecords }, "facility", "batch");
  const params = new URL(link.href, "https://noma.test").searchParams;
  expect(params.get("ids")).toBe(fixTarget === "deliveries" ? null : "one,two");
  expect(params.get("facility")).toBe("facility");
  expect(params.get("creditBatch")).toBe("batch");
});
