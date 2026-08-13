import { describe, expect, it } from "vitest";
import { evaluateSampled1000YearReplicates } from "./durability-1000-replicates";

function sample(args: {
  id: string;
  total?: number | null;
  inorganic?: number | null;
  sFraction?: number | null;
}) {
  return {
    id: args.id,
    sampleCode: `LAB-${args.id}`,
    totalCarbonPercent: "total" in args ? (args.total ?? null) : 80,
    inorganicCarbonPercent:
      "inorganic" in args ? (args.inorganic ?? null) : 1,
    sReflectanceFraction:
      "sFraction" in args ? (args.sFraction ?? null) : 0.9,
  };
}

describe("evaluateSampled1000YearReplicates", () => {
  it("orders one paired replicate set by Sample id", () => {
    const result = evaluateSampled1000YearReplicates({
      creditBatchCode: "CB-1",
      samples: [sample({ id: "c" }), sample({ id: "a" }), sample({ id: "b" })],
    });

    expect(result.blockers).toEqual([]);
    expect(result.replicates.map((replicate) => replicate.sampleId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.replicates[0]).toMatchObject({
      totalCarbonContentFraction: 0.8,
      inorganicCarbonContentFraction: 0.01,
      sFraction: 0.9,
    });
  });

  it("fails closed with the Sample code when inorganic carbon was not measured", () => {
    const result = evaluateSampled1000YearReplicates({
      creditBatchCode: "CB-1",
      samples: [
        sample({ id: "a" }),
        sample({ id: "b", inorganic: null }),
        sample({ id: "c" }),
      ],
    });

    expect(result.blockers.join("\n")).toMatch(
      /missing measured inorganic carbon.*LAB-b/,
    );
    expect(result.replicates).toHaveLength(2);
  });

  it("allows the shared analytical tolerance and rejects larger inorganic excess", () => {
    const withinTolerance = evaluateSampled1000YearReplicates({
      creditBatchCode: "CB-1",
      samples: [
        sample({ id: "a", total: 1, inorganic: 1.5 }),
        sample({ id: "b" }),
        sample({ id: "c" }),
      ],
    });
    expect(withinTolerance.blockers).toEqual([]);

    const excessive = evaluateSampled1000YearReplicates({
      creditBatchCode: "CB-1",
      samples: [
        sample({ id: "a", total: 1, inorganic: 1.51 }),
        sample({ id: "b" }),
        sample({ id: "c" }),
      ],
    });
    expect(excessive.blockers.join("\n")).toMatch(
      /inorganic carbon above total carbon.*LAB-a/,
    );
  });

  it("rejects negative measured inorganic carbon", () => {
    const result = evaluateSampled1000YearReplicates({
      creditBatchCode: "CB-1",
      samples: [
        sample({ id: "a", inorganic: -0.1 }),
        sample({ id: "b" }),
        sample({ id: "c" }),
      ],
    });

    expect(result.blockers.join("\n")).toMatch(/negative inorganic carbon.*LAB-a/);
  });
});
