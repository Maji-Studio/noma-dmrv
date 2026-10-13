import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/transport-legs", () => ({ TransportLegsSummary: () => null }));
vi.mock("./sample-documents-panel", () => ({ SampleDocumentsPanel: () => null }));

import { formatSamplingTime } from "./sample-read-sections";

describe("formatSamplingTime", () => {
  const samplingTime = new Date("2026-03-10T07:30:00.000Z");

  it("reads the time on the batch facility's clock", () => {
    // 07:30 UTC is 10:30 in Dar es Salaam (UTC+3).
    expect(formatSamplingTime({ samplingTime, facilityTimezone: "Africa/Dar_es_Salaam" })).toContain("10:30");
    expect(formatSamplingTime({ samplingTime, facilityTimezone: "UTC" })).toContain("07:30");
  });
});
