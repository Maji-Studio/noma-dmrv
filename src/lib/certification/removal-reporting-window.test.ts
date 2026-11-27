import { expect, it } from "vitest";
import { aggregateProductionRuns, type ProductionRunForCertification } from "@/lib/isometric/utils/aggregation";
import { resolveRemovalReportingWindow } from "./removal-reporting-window";

it("extends only the reporting start for a failed contributor spanning the material and application dates", () => {
  const material = { id: "material", code: "PR-M", status: "complete",
    startTime: new Date("2026-03-10T12:00:00Z"), endTime: new Date("2026-03-11T12:00:00Z"),
    biocharDryMassKg: 100, samples: [],
  } as unknown as ProductionRunForCertification;
  const failed = { ...material, id: "failed", code: "PR-F", status: "failed" as const,
    startTime: new Date("2026-03-01T23:00:00Z"), endTime: new Date("2026-03-30T12:00:00Z") };
  const agg = aggregateProductionRuns([material], undefined, { failedContributors: [failed] });
  const args = { earliestProductionStartTime: agg.earliestStartTime, latestProductionEndTime: agg.latestEndTime,
    latestApplicationTime: new Date("2026-03-12T00:00:00Z"), facilityTimezone: "Africa/Dar_es_Salaam" };
  expect(agg.earliestStartTime).toEqual(material.startTime);
  expect(agg.latestEndTime).toEqual(material.endTime);
  const original = resolveRemovalReportingWindow(args);
  const withFailed = resolveRemovalReportingWindow({ ...args, failedContributorStartTimes: [failed.startTime] });
  expect(original.startedOn).toEqual(new Date("2026-03-10T00:00:00Z"));
  expect(withFailed.startedOn).toEqual(new Date("2026-03-02T00:00:00Z"));
  expect(withFailed.completedOn).toEqual(original.completedOn);
});
