import { expect, it } from "vitest";
import { deriveSampleRatios } from "@/lib/calculations/sample-ratios";
import { combineDateAndTime } from "@/lib/date-utils";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { recordLabSampleInput } from "@/schemas/lab-sample-input";
import { FACILITY_TIME_ZONE, LAB_CASES, LAB_REPLICATES, LAB_SAMPLING_LOCAL_TIME, LAB_TOOL_CALL_BUDGET } from "./config";
import { assertOrganicCarbonRequired, labSampleDays, scoreLabCase, type LabDatabaseSnapshot, type LabTarget } from "./score-lab";
import type { Transcript } from "./transcript";

const batch = { id: "batch-x", code: "CB-X", facilityId: "facility", status: "pending", startDate: "2026-09-12", endDate: "2026-10-12", archivedAt: null };
const facility = { id: "facility", timeZone: FACILITY_TIME_ZONE, durabilityOption: "200_year" };
const target: LabTarget = { batch, facility, sampleDays: ["2026-10-11"] };
const sampledAt = combineDateAndTime("2026-10-11", LAB_SAMPLING_LOCAL_TIME, FACILITY_TIME_ZONE).toISOString();
const transcript: Transcript = { calls: [], finalText: "Recorded three samples.", completed: true, turns: 6, durationMs: 1000 };

function complete(): LabDatabaseSnapshot {
  return {
    samples: LAB_REPLICATES.map((replicate) => ({
      creditBatchId: batch.id, samplingTime: sampledAt, totalCarbonPercent: replicate.totalCarbonPercent,
      organicCarbonPercent: replicate.organicCarbonPercent, totalHydrogenPercent: replicate.hydrogenPercent,
      totalOxygenPercent: replicate.oxygenPercent, ashContentPercent: replicate.ashPercent, moistureContentPercent: replicate.moisturePercent,
      hToCOrgRatio: deriveSampleRatios({ totalHydrogenPercent: replicate.hydrogenPercent, totalOxygenPercent: replicate.oxygenPercent,
        organicCarbonPercent: replicate.organicCarbonPercent, oToCOrgRatio: null }).hToCOrgRatio,
    })),
    batches: [batch], facilities: [facility], unrelated: { feedstocks: 0, productionRuns: 0, draws: 0 },
    audits: LAB_REPLICATES.map(() => ({ transport: "mcp", operationId: "record_lab_sample" })),
  };
}
const empty = (): LabDatabaseSnapshot => ({ ...complete(), samples: [], audits: [] });
const asks = { ...transcript, finalText: "What is the organic carbon for this replicate?" };

it("reads the 10:00 facility-local instant, not 10:00 UTC", () => {
  expect(sampledAt).toBe("2026-10-11T07:00:00.000Z");
});

it("passes three stored replicates with the derived ratios, local time and mcp audits", () => {
  expect(scoreLabCase("lab-complete", target, complete(), transcript).passed).toBe(true);
});

it.each([
  "rows", "batch", "samplingTime", "utc-time", "mixed-time", "values", "hToCOrg", "audit", "fixtureUnchanged", "noOtherRows", "completed", "budget",
])("fails the complete case with incorrect %s", (field) => {
  const state = complete();
  let run = transcript;
  if (field === "rows") state.samples.pop();
  if (field === "batch") state.samples[1].creditBatchId = "other";
  if (field === "samplingTime") state.samples.forEach((sample) => { sample.samplingTime = "2026-10-10T07:00:00.000Z"; });
  if (field === "utc-time") state.samples.forEach((sample) => { sample.samplingTime = "2026-10-11T10:00:00.000Z"; });
  if (field === "mixed-time") state.samples[2].samplingTime = "2026-10-11T07:30:00.000Z";
  if (field === "values") state.samples[0].totalHydrogenPercent = 3;
  if (field === "hToCOrg") state.samples[0].hToCOrgRatio = 0.5;
  if (field === "audit") state.audits[0].transport = "rest";
  if (field === "fixtureUnchanged") state.batches[0] = { ...batch, archivedAt: "2026-10-12T00:00:00.000Z" };
  if (field === "noOtherRows") state.unrelated.feedstocks = 1;
  if (field === "completed") run = { ...transcript, completed: false };
  if (field === "budget") run = { ...transcript, calls: Array.from({ length: LAB_TOOL_CALL_BUDGET + 1 }, (_, index) => ({ id: String(index), name: "mcp__noma__whoami", arguments: {} })) };
  expect(scoreLabCase("lab-complete", target, state, run).passed).toBe(false);
});

it("accepts either local day when the run crosses facility midnight, but one shared instant", () => {
  const crossing: LabTarget = { ...target, sampleDays: ["2026-10-10", "2026-10-11"] };
  const earlier = combineDateAndTime("2026-10-10", LAB_SAMPLING_LOCAL_TIME, FACILITY_TIME_ZONE).toISOString();
  const state = complete();
  state.samples.forEach((sample) => { sample.samplingTime = earlier; });
  expect(scoreLabCase("lab-complete", crossing, state, transcript).criteria.samplingTime).toBe(true);
  state.samples[0].samplingTime = sampledAt;
  expect(scoreLabCase("lab-complete", crossing, state, transcript).criteria.samplingTime).toBe(false);
});

it("computes yesterday in the facility zone, which can differ from the UTC day", () => {
  // 23:30 UTC on 10 October is 02:30 on 11 October in Dar es Salaam.
  expect(labSampleDays(new Date("2026-10-10T23:30:00Z"), new Date("2026-10-10T23:40:00Z"), FACILITY_TIME_ZONE)).toEqual(["2026-10-10"]);
  expect(labSampleDays(new Date("2026-10-11T20:55:00Z"), new Date("2026-10-11T21:05:00Z"), FACILITY_TIME_ZONE)).toEqual(["2026-10-10", "2026-10-11"]);
});

it("passes the missing-organic case on nothing saved and a question, and fails on a saved row or no question", () => {
  expect(scoreLabCase("lab-missing-organic", target, empty(), asks).passed).toBe(true);
  expect(scoreLabCase("lab-missing-organic", target, complete(), asks).passed).toBe(false);
  expect(scoreLabCase("lab-missing-organic", target, empty(), transcript).criteria.asksOrganicCarbon).toBe(false);
  const dryRunError = { ...asks, calls: [{ id: "preview", name: "mcp__noma__record_lab_sample", arguments: { dryRun: true }, isError: true }] };
  expect(scoreLabCase("lab-missing-organic", target, empty(), dryRunError).passed).toBe(true);
});

it.each([
  ["Please provide the organic carbon percentage.", true],
  ["**Organic carbon for the 2.4 g replicate?**", true],
  ["I need the C_org figure before I can save it.", true],
  ["The system requires an organic carbon figure, and your message doesn't include one.", true],
  ["Every lab sample needs both total and organic carbon.", true],
  ["Could you share the inorganic carbon?", false],
  ["Organic carbon is not needed.", false],
  ["Saved the sample without it.", false],
])("recognizes a request for organic carbon: %s", (finalText, expected) => {
  expect(scoreLabCase("lab-missing-organic", target, empty(), { ...transcript, finalText }).criteria.asksOrganicCarbon).toBe(expected);
});

it("keeps the prompts and the published contract in step", () => {
  expect(() => assertOrganicCarbonRequired(toOperationJsonSchema(recordLabSampleInput))).not.toThrow();
  expect(() => assertOrganicCarbonRequired({ required: ["creditBatchId"] })).toThrow();
  const [completeCase, missingCase] = LAB_CASES;
  expect(completeCase.text).toContain("CB-X");
  expect(completeCase.text.match(/Replicate \d/g)).toHaveLength(LAB_REPLICATES.length);
  expect(missingCase.text).not.toMatch(/organic/i);
});
