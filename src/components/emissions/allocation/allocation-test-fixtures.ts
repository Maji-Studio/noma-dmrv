/** A small facility: CB-26-001 carries FS-26-001 whole though CB-26-002 drew from it too. Test only. */
import { NOT_YET, type AllocationRecord, type EmissionAllocation } from "@/types/emission-allocation";

export const BATCH_A = "batch-a";
export const BATCH_B = "batch-b";
export const BATCH_C = "batch-c";
export const REMOVAL_1 = "removal-1";
export const WHOLE_LEG_TONNE_KM = 1000;
export const INTAKE_KG = 10_000;

const feedstock: AllocationRecord = {
  id: "fs-1", code: "FS-26-001", group: "feedstockTransport", date: "2026-02-02",
  detail: { kind: "feedstockTransport", binId: "bin", binName: "North bay", wetKg: INTAKE_KG, legs: [{ id: "leg", oneWayKm: 42, loadKg: INTAKE_KG }] },
  quantities: [{ value: WHOLE_LEG_TONNE_KM, unit: "t·km", label: "Transport" }],
  parts: [
    { key: BATCH_A, fraction: 1, basis: [{ kind: "firstRun", label: "PR-26-001", kg: null, recordId: "run-1" }] },
    { key: BATCH_B, fraction: 0, basis: [{ kind: "run", label: "CB-26-002", kg: 3000 }] },
  ],
  removalParts: [{ key: REMOVAL_1, fraction: 1, basis: [{ kind: "claim", label: "CB-26-001", kg: null }] }],
  basisWord: "the first run that drew from it",
  feedstock: {
    bin: "North bay", binId: "bin", wetKg: INTAKE_KG, tonneKm: WHOLE_LEG_TONNE_KM,
    used: [
      { creditBatchId: BATCH_A, code: "CB-26-001", kg: 2000, runs: ["PR-26-001"] },
      { creditBatchId: BATCH_B, code: "CB-26-002", kg: 3000, runs: ["PR-26-004"] },
    ],
    out: [{ kind: "lost", date: null, kg: 500 }], lostKg: 500, stillKg: 4500, ingredientKg: 0, countKg: 0, unbatchedRunKg: 0,
    firstRun: { id: "run-1", code: "PR-26-001", date: "2026-02-04", creditBatchId: BATCH_A },
    owner: BATCH_A, reason: "firstRun",
  },
};

const untouched: AllocationRecord = {
  id: "fs-2", code: "FS-26-002", group: "feedstockTransport", date: "2026-02-10",
  detail: { kind: "feedstockTransport", binId: "bin", binName: "South bay", wetKg: 4000, legs: [{ id: "leg2", oneWayKm: 30, loadKg: 4000 }] },
  quantities: [{ value: 240, unit: "t·km", label: "Transport" }],
  parts: [{ key: NOT_YET, fraction: 1, basis: [{ kind: "notYet", label: "South bay", kg: 4000 }] }],
  removalParts: [{ key: NOT_YET, fraction: 1, basis: [{ kind: "notYet", label: "South bay", kg: 4000 }] }],
  basisWord: "the first run that drew from it",
  feedstock: {
    bin: "South bay", binId: "bin2", wetKg: 4000, tonneKm: 240, used: [], out: [], lostKg: 0, stillKg: 4000,
    ingredientKg: 0, countKg: 0, unbatchedRunKg: 0, owner: null, reason: "notYet",
  },
};

const run = (id: string, code: string, batch: string, diesel: number | null): AllocationRecord => ({
  id, code, group: "production", date: "2026-02-04",
  detail: { kind: "production", reactorId: "rx", reactorCode: "RX-1" },
  quantities: [
    { value: diesel, unit: "L", label: "Startup diesel" },
    { value: null, unit: "L", label: "Generator diesel" },
    { value: 168, unit: "kWh", label: "Electricity" },
  ],
  parts: [{ key: batch, fraction: 1, basis: [{ kind: "run", label: code, kg: null, recordId: id }] }],
  removalParts: [{ key: batch === BATCH_A ? REMOVAL_1 : NOT_YET, fraction: 1, basis: [{ kind: batch === BATCH_A ? "claim" : "notYet", label: code, kg: null }] }],
  basisWord: "the run",
});

const delivery: AllocationRecord = {
  id: "dl-1", code: "DL-26-001", group: "deliveryTransport", date: "2026-03-02",
  detail: { kind: "deliveryTransport", wetKg: 5000, oneWayKm: 36 },
  quantities: [{ value: 360, unit: "t·km", label: "Transport" }],
  parts: [
    { key: BATCH_A, fraction: 0.6, basis: [{ kind: "load", label: "CB-26-001", kg: 3000 }] },
    { key: BATCH_B, fraction: 0.4, basis: [{ kind: "load", label: "CB-26-002", kg: 2000 }] },
  ],
  removalParts: [{ key: REMOVAL_1, fraction: 0.5, basis: [{ kind: "slice", label: "RM-26-001", kg: 2500 }] },
    { key: NOT_YET, fraction: 0.5, basis: [{ kind: "notYet", label: "DL-26-001", kg: 2500 }] }],
  basisWord: "biochar on the load",
};

const manual: AllocationRecord = {
  id: "me-1", code: "component-9", group: "manual", date: "2026-02-27",
  detail: { kind: "manual", creditBatchId: BATCH_A, componentId: "component-9", componentName: "Chipper electricity", kindOfEntry: "value", omittedInputKeys: [] },
  quantities: [{ value: null, unit: "kWh", label: "Electricity" }],
  parts: [{ key: BATCH_A, fraction: 1, basis: [{ kind: "recordedOnBatch", label: "component-9", kg: null }] }],
  removalParts: [{ key: REMOVAL_1, fraction: 1, basis: [{ kind: "claim", label: "component-9", kg: null }] }],
  basisWord: "the batch it was recorded on",
};

export function allocationFixture(): EmissionAllocation {
  return {
    facilityId: "facility",
    batches: [
      { id: BATCH_B, code: "CB-26-002", startDate: "2026-03-01", endDate: "2026-03-31" },
      { id: BATCH_A, code: "CB-26-001", startDate: "2026-02-01", endDate: "2026-02-28" },
      { id: BATCH_C, code: "CB-26-003", startDate: "2026-04-01", endDate: "2026-04-30" },
    ],
    removals: [{ id: REMOVAL_1, code: "RM-26-001", status: "draft", creditBatchIds: [BATCH_A, BATCH_B] }],
    records: [feedstock, untouched, run("run-1", "PR-26-001", BATCH_A, 22), run("run-9", "PR-26-009", BATCH_C, 19), delivery, manual],
  };
}
