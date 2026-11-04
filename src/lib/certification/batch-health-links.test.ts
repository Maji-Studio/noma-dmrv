import { expect, it } from "vitest";
import { recordHref } from "@/lib/record-links";
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


it("filters multiple feedstocks exactly and preserves the single-record edit link", () => {
  const affectedRecords = records.map(({ id, code, missing }) => ({ id, code, missing }));
  const check = { key: "transport" as const, fixTarget: "feedstocks" as const, affectedRecords };
  expect(batchHealthFixLinkFor(check, "facility", "batch")).toEqual({
    label: "Review feedstock transport", href: "/feedstock-intake?facility=facility&ids=one%2Ctwo",
  });
  expect(batchHealthFixLinkFor({ ...check, affectedRecords: affectedRecords.slice(0, 1) }, "facility").href)
    .toBe("/feedstock-intake?facility=facility&feedstock=one&mode=edit&focus=transport-evidence");
  expect(batchHealthFixLinkFor({ ...check, affectedRecords: [] }, "facility").href)
    .toBe("/feedstock-intake?facility=facility");
});

it("keeps the feedstock location shortcut when every affected record shares it", () => {
  expect(batchHealthFixLinkFor({ key: "transport", fixTarget: "feedstocks", affectedRecords: records }, "facility"))
    .toEqual({ label: "Edit location distances", href: records[0].href });
  expect(batchHealthFixLinkFor({ key: "transport", fixTarget: "feedstocks",
    affectedRecords: [records[0], { ...records[1], href: undefined }] }, "facility").href)
    .toBe("/feedstock-intake?facility=facility&ids=one%2Ctwo");
});

it("opens one blocked order's sheet and lists several by exact ids", () => {
  expect(batchHealthFixLinkFor({ key: "entityReadiness", fixTarget: "orders", affectedRecords: records.slice(0, 1) }, "facility", "batch"))
    .toEqual({ label: "Review DL-1", href: recordHref("order", "one", { facilityId: "facility" }) });
  expect(batchHealthFixLinkFor({ key: "entityReadiness", fixTarget: "orders", affectedRecords: records }, "facility", "batch"))
    .toEqual({ label: "Review orders", href: "/orders?facility=facility&ids=one%2Ctwo" });
});
