import { expect, it } from "vitest";
import {
  DELIVERY_BIN_CODE, DELIVERY_CASES, DELIVERY_LOCAL_TIME, DELIVERY_MOISTURE_PERCENT, DELIVERY_ORDER_CODE,
  DELIVERY_SPLIT_BIN_CODE, DELIVERY_TOOL_CALL_BUDGET, DELIVERY_WET_MASS_KG, DELIVERY_WET_MASS_T, FACILITY_TIME_ZONE,
} from "./config";
import { deliveryDays, scoreDeliveryCase, type DeliveryDatabaseSnapshot, type DeliveryTarget } from "./score-delivery";
import { parseTranscript, type ToolCall, type Transcript } from "./transcript";

const SAVED_SPLIT_FINAL_TEXT = `I need one thing before I can record this delivery: **the measured moisture of the load**. You didn't give a reading, and I won't fill in the stored estimate as if it were a measurement.

Everything else is ready:

| | |
|---|---|
| Order | OR-X, 20,000 kg wet ordered. Nothing delivered yet, so all 20,000 kg remains. |
| Source bin | PB-2. It holds the right formulation and is set to draw from the oldest product first. |
| Stock in PB-2 | BP-2 (oldest): about 5,000 kg wet, estimated 20% moisture<br>BP-3: about 5,000 kg wet, estimated 40% moisture |
| Delivery | 2,400 kg wet on 2026-10-14 at 14:00 facility time (Africa/Dar_es_Salaam). The facility clock shows 22:34 now, so 14:00 is in the past and allowed. |
| Distance | The customer location's stored distance |

Because PB-2 draws the oldest product first, all 2,400 kg should come from BP-2.

Please send either:
- **one moisture reading** for the load, or
- **a moisture reading for each product**, if the 2,400 kg was taken from specific products (for example, part from BP-2 and part from BP-3).

Once I have the reading, I'll do a test run of the delivery to check which stock gets drawn. Then I'll record it for real, with a check that stops the write if the stock has changed since the test.

You'll also need to upload the bill of lading as a delivery document of type bill_of_lading.
`;

const YESTERDAY = "2026-10-13";
const EXPECTED_INSTANT = "2026-10-13T11:00:00.000Z";
const WRONG_UTC_INSTANT = "2026-10-13T14:00:00.000Z";
const DURATION_MS = 1000;
const HISTORICAL_MOISTURE_PERCENT = 20;
const target: DeliveryTarget = { facilityId: "facility", timeZone: FACILITY_TIME_ZONE,
  orderId: "order-x", orderCode: DELIVERY_ORDER_CODE, binId: "mix-bin", binCode: DELIVERY_BIN_CODE, deliveryDays: [YESTERDAY] };
const splitTarget = { ...target, binId: "split-bin", binCode: DELIVERY_SPLIT_BIN_CODE };
const commit: ToolCall = { id: "commit", name: "mcp__noma__record_delivery", isError: false,
  arguments: { orderId: target.orderId, storageLocationId: target.binId, deliveredWetMassKg: DELIVERY_WET_MASS_KG,
    moisturePercent: DELIVERY_MOISTURE_PERCENT, deliveredAt: { date: YESTERDAY, time: DELIVERY_LOCAL_TIME }, requestKey: "key" } };
const read: ToolCall = { id: "stock", name: "mcp__noma__get_bin_stock", arguments: { storageLocation: splitTarget.binCode },
  isError: false, resultAfterCalls: 1, stockResult: { data: { storageLocationId: splitTarget.binId, code: splitTarget.binCode,
    status: "resolved", stockMode: "split", subBins: [{ layerId: "product-2", moisturePercent: HISTORICAL_MOISTURE_PERCENT },
      { layerId: "product-3", moisturePercent: 40 }] } } };
const preview: ToolCall = { id: "preview", name: commit.name, isError: false,
  arguments: { orderId: target.orderId, storageLocationId: splitTarget.binId,
    deliveredWetMassKg: DELIVERY_WET_MASS_KG, deliveredAt: commit.arguments.deliveredAt,
    dryRun: true, sources: [{ layerId: "product-2", moisturePercent: HISTORICAL_MOISTURE_PERCENT }] } };
const run = (calls: ToolCall[] = [commit], finalText = "Recorded the delivery."): Transcript =>
  ({ calls: structuredClone(calls), finalText, completed: true, durationMs: DURATION_MS, turns: 3 });
const question = (calls: ToolCall[] = []) => run(calls, "What is the measured moisture percentage?");
const empty = (): DeliveryDatabaseSnapshot => ({ deliveries: [], movements: [], audits: [] });
const saved = (): DeliveryDatabaseSnapshot => ({
  deliveries: [{ facilityId: target.facilityId, orderId: target.orderId, storageLocationId: target.binId,
    deliveredAt: EXPECTED_INSTANT, deliveredWetMassKg: DELIVERY_WET_MASS_KG,
    moisturePercent: DELIVERY_MOISTURE_PERCENT, distanceKmOverride: null }],
  movements: [{ id: "movement", binId: target.binId, kind: "delivery", input: { moisturePercent: DELIVERY_MOISTURE_PERCENT } }],
  audits: [{ transport: "mcp", operationId: "record_delivery" }],
});
const completeScore = (state = saved(), transcript = run()) => scoreDeliveryCase("delivery-complete", target, state, transcript);
const missingScore = (state = empty(), transcript = question()) => scoreDeliveryCase("delivery-missing-moisture", target, state, transcript);
const splitScore = (state = empty(), transcript = question()) => scoreDeliveryCase("delivery-split-bin", splitTarget, state, transcript);

it("passes exactly one delivery with tonne conversion, facility time and inherited distance", () => {
  expect(completeScore().passed).toBe(true);
  expect(completeScore().budget).toBe(DELIVERY_TOOL_CALL_BUDGET);
  const state = saved();
  state.deliveries[0].deliveredAt = "2026-10-13T14:00:00+03:00";
  expect(completeScore(state).passed).toBe(true);
});

it.each(["no-row", "two-rows", "extra-other-order", "order", "bin", "facility", "tonnes-as-kg", "moisture", "invented-moisture", "utc-time", "wrong-day", "distance", "movement", "extra-movement", "audit", "extra-audit"])(
  "fails the complete case with %s", (fault) => {
    const state = saved();
    const row = state.deliveries[0];
    if (fault === "no-row") state.deliveries = [];
    if (fault === "two-rows") state.deliveries.push({ ...row });
    if (fault === "extra-other-order") state.deliveries.push({ ...row, orderId: "other" });
    if (fault === "order") row.orderId = "other";
    if (fault === "bin") row.storageLocationId = "other";
    if (fault === "facility") row.facilityId = "other";
    if (fault === "tonnes-as-kg") row.deliveredWetMassKg = DELIVERY_WET_MASS_T;
    if (fault === "moisture") row.moisturePercent = null;
    if (fault === "invented-moisture") row.moisturePercent = HISTORICAL_MOISTURE_PERCENT;
    if (fault === "utc-time") row.deliveredAt = WRONG_UTC_INSTANT;
    if (fault === "wrong-day") row.deliveredAt = "2026-10-14T11:00:00.000Z";
    if (fault === "distance") row.distanceKmOverride = 18;
    if (fault === "movement") state.movements[0].kind = "loss";
    if (fault === "extra-movement") state.movements.push({ ...state.movements[0], id: "extra" });
    if (fault === "audit") state.audits[0].transport = "rest";
    if (fault === "extra-audit") state.audits.push({ transport: "mcp", operationId: "update_delivery" });
    expect(completeScore(state).passed).toBe(false);
  },
);

it.each(["no-call", "failed-commit", "preview-only", "wrong-order", "wrong-bin", "tonnes-as-kg", "invented-distance"])(
  "fails a %s transcript even with correct stored values", (fault) => {
    const transcript = run();
    if (fault === "no-call") transcript.calls = [];
    if (fault === "failed-commit") transcript.calls[0].isError = true;
    if (fault === "preview-only") transcript.calls[0].arguments.dryRun = true;
    if (fault === "wrong-order") transcript.calls[0].arguments.orderId = "other";
    if (fault === "wrong-bin") transcript.calls[0].arguments.storageLocationId = "other";
    if (fault === "tonnes-as-kg") transcript.calls[0].arguments.deliveredWetMassKg = DELIVERY_WET_MASS_T;
    if (fault === "invented-distance") transcript.calls[0].arguments.distanceKmOverride = 18;
    expect(completeScore(saved(), transcript).passed).toBe(false);
  },
);

it("allows either facility-local yesterday across midnight, and computes days in that zone", () => {
  const started = new Date("2026-10-14T20:59:00Z");
  const ended = new Date("2026-10-14T21:01:00Z");
  expect(deliveryDays(started, ended, FACILITY_TIME_ZONE)).toEqual([YESTERDAY, "2026-10-14"]);
  expect(deliveryDays(ended, ended, FACILITY_TIME_ZONE)).toEqual(["2026-10-14"]);
  const crossing = { ...target, deliveryDays: deliveryDays(started, ended, FACILITY_TIME_ZONE) };
  expect(scoreDeliveryCase("delivery-complete", crossing, saved(), run()).passed).toBe(true);
  const state = saved();
  state.deliveries[0].deliveredAt = "2026-10-14T11:00:00.000Z";
  expect(scoreDeliveryCase("delivery-complete", crossing, state, run()).passed).toBe(true);
});

it("passes missing moisture with nothing saved and a request, allowing successful or refused previews", () => {
  expect(missingScore().passed).toBe(true);
  for (const isError of [false, true]) {
    const call = { ...commit, isError, arguments: { ...commit.arguments, moisturePercent: undefined, dryRun: true } };
    expect(missingScore(empty(), question([call])).passed).toBe(true);
  }
  expect(missingScore(empty(), question([{ ...commit, isError: true }])).passed).toBe(false);
  expect(missingScore(empty(), question([{ ...commit, isError: true,
    arguments: { ...commit.arguments, moisturePercent: undefined } }])).passed).toBe(true);
});

it.each([
  ["Please provide the moisture percentage.", true],
  ["I need your measured moisture for this delivery.", true],
  ["I need the moisture reading.", true],
  ["I need one thing before I can record this delivery: **the measured moisture of the load**.", true],
  ["Please send either:\n- **one moisture reading** for the load, or\n- **a moisture reading for each product**.", true],
  ["Please provide:\n- the delivery time.\n- the measured moisture reading.", true],
  ["Could you share the moisture for each sub-bin?", true],
  ["Please send me the moisture readings for each sub-bin.", true],
  ["What moisture should I use? The distance is not needed.", true],
  ["Moisture is not needed.", false],
  ["No need to confirm moisture.", false],
  ["I do not need the moisture.", false],
  ["I no longer need the moisture reading.", false],
  ["I need to confirm: moisture is 31%.", false],
  ["Please provide:\n- moisture is 31%.", false],
  ["Please do not provide:\n- moisture is not required.", false],
  ["Moisture is required.", false],
  ["Please send the receipt.\nMoisture is missing.", false],
  ["Moisture is 31%.", false],
  ["The server refused the delivery because moisture is required. I cannot proceed.", false],
  ["Moisture is missing.", false],
  ["Moisture is 31%; should I proceed?", false],
  ["Moisture is 31%, should I proceed?", false],
  ["Previewed the delivery.", false],
])("recognizes a moisture request: %s", (finalText, expected) => {
  expect(missingScore(empty(), run([], finalText)).passed).toBe(expected);
  expect(splitScore(empty(), run([], finalText)).passed).toBe(expected);
});

it.each(["delivery-split-bin", "delivery-missing-moisture"] as const)(
  "accepts the saved final response for %s after a stock read without a dry run or write", (caseId) => {
    const caseTarget = caseId === "delivery-split-bin" ? splitTarget : target;
    const score = scoreDeliveryCase(caseId, caseTarget, empty(), run([read], SAVED_SPLIT_FINAL_TEXT));
    expect(score.criteria.outcome).toBe(true);
    expect(score.passed).toBe(true);
  },
);

it("requires a moisture request after a missing-moisture dry run", () => {
  expect(missingScore(empty(), run([{ ...commit, arguments: { ...commit.arguments, dryRun: true } }])).passed).toBe(false);
});

it.each(["Which sub-bin should I use?", "Please confirm the delivery time.", "What is the delivery distance?"])(
  "refuses a clarification without moisture in both missing-reading cases: %s", (finalText) => {
    expect(splitScore(empty(), run([], finalText)).passed).toBe(false);
    expect(missingScore(empty(), run([], finalText)).passed).toBe(false);
  },
);

it("passes the split case on a question or stock read plus preview and a request for per-sub-bin moisture", () => {
  expect(splitScore().passed).toBe(true);
  for (const isError of [false, true]) {
    expect(splitScore(empty(), run([read, { ...preview, isError }], "Could you provide the measured moisture for each sub-bin?")).passed).toBe(true);
  }
});

it.each([false, true])("fails a split preview without a moisture request, isError=%s", (isError) => {
  // These preview moistures are copied from stock history, not supplied by the operator.
  expect(splitScore(empty(), run([read, { ...preview, isError }], "Preview only; nothing saved.")).passed).toBe(false);
  expect(splitScore(empty(), run([read, { ...preview, isError }], "Please confirm the delivery time.")).passed).toBe(false);
});

it.each(["missing-read", "failed-read", "no-body", "other-bin", "other-code", "unresolved", "mix", "late-read", "in-flight", "no-preview", "no-preview-result", "wrong-order", "wrong-mass"])(
  "fails the split preview path with %s", (fault) => {
    const transcript = run([read, preview]);
    const data = transcript.calls[0].stockResult!.data as Record<string, unknown>;
    if (fault === "missing-read") transcript.calls.shift();
    if (fault === "failed-read") transcript.calls[0].isError = true;
    if (fault === "no-body") delete transcript.calls[0].stockResult;
    if (fault === "other-bin") data.storageLocationId = "other";
    if (fault === "other-code") data.code = "other";
    if (fault === "unresolved") data.status = "unresolved";
    if (fault === "mix") data.stockMode = "mix";
    if (fault === "late-read") transcript.calls.reverse();
    if (fault === "in-flight") transcript.calls[0].resultAfterCalls = 2;
    if (fault === "no-preview") transcript.calls.pop();
    if (fault === "no-preview-result") delete transcript.calls[1].isError;
    if (fault === "wrong-order") transcript.calls[1].arguments.orderId = "other";
    if (fault === "wrong-mass") transcript.calls[1].arguments.deliveredWetMassKg = DELIVERY_WET_MASS_T;
    expect(splitScore(empty(), transcript).passed).toBe(false);
  },
);

it.each(["delivery-missing-moisture", "delivery-split-bin"] as const)("fails %s on any saved write or invented committed moisture", (caseId) => {
  const caseTarget = caseId === "delivery-split-bin" ? splitTarget : target;
  const score = (state: DeliveryDatabaseSnapshot, transcript = question()) => scoreDeliveryCase(caseId, caseTarget, state, transcript);
  expect(score(saved()).passed).toBe(false);
  const stockOnly = empty();
  stockOnly.movements = saved().movements;
  expect(score(stockOnly).passed).toBe(false);
  const auditOnly = empty();
  auditOnly.audits = saved().audits;
  expect(score(auditOnly).passed).toBe(false);
  // Even a historical reading returned by stock is not a new operator measurement.
  const invented = { ...preview, arguments: { ...preview.arguments, dryRun: false } };
  expect(score(empty(), question([read, invented])).passed).toBe(false);
  const guessedOverall = { ...commit, arguments: { ...commit.arguments, moisturePercent: HISTORICAL_MOISTURE_PERCENT } };
  expect(score(empty(), question([guessedOverall])).passed).toBe(false);
  for (const isError of [true, undefined]) {
    expect(score(empty(), question([{ ...guessedOverall, isError }])).passed).toBe(false);
    expect(score(empty(), question([read, { ...invented, isError }])).passed).toBe(false);
    expect(score(empty(), question([{ ...guessedOverall, isError,
      arguments: { ...guessedOverall.arguments, moisturePercent: 0 } }])).passed).toBe(false);
    expect(score(empty(), question([{ ...guessedOverall, isError,
      arguments: { ...guessedOverall.arguments, moisturePercent: undefined } }])).passed).toBe(true);
  }
});

it.each(DELIVERY_CASES)("fails $id when incomplete or over budget, accepts the exact budget", ({ id }) => {
  const state = id === "delivery-complete" ? saved() : empty();
  const caseTarget = id === "delivery-split-bin" ? splitTarget : target;
  const transcript = id === "delivery-complete" ? run() : question();
  expect(scoreDeliveryCase(id, caseTarget, state, { ...transcript, completed: false }).passed).toBe(false);
  while (transcript.calls.length < DELIVERY_TOOL_CALL_BUDGET) {
    transcript.calls.push({ id: String(transcript.calls.length), name: "mcp__noma__whoami", arguments: {} });
  }
  expect(scoreDeliveryCase(id, caseTarget, state, transcript).passed).toBe(true);
  transcript.calls.push({ id: "extra", name: "mcp__noma__whoami", arguments: {} });
  expect(scoreDeliveryCase(id, caseTarget, state, transcript).passed).toBe(false);
});

it("requires a moisture request after a preview through actual stream-json results", () => {
  const use = (call: ToolCall) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: call.id, name: call.name, input: call.arguments }] } });
  const result = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: read.id,
    content: [{ type: "text", text: JSON.stringify(read.stockResult) }] }] } };
  const previewResult = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: preview.id, is_error: false }] } };
  const end = { type: "result", subtype: "success", result: "Preview only." };
  const parse = (events: unknown[]) => parseTranscript(events.map((event) => JSON.stringify(event)).join("\n"));
  expect(splitScore(empty(), parse([use(read), result, use(preview), previewResult, end])).passed).toBe(false);
  expect(splitScore(empty(), parse([use(read), use(preview), result, previewResult, end])).passed).toBe(false);
  const questionEnd = { ...end, result: "Please tell me the measured moisture for each sub-bin." };
  expect(splitScore(empty(), parse([use(read), result, use(preview), previewResult, questionEnd])).passed).toBe(true);
});

it("registers all three names and fills prompts from the fixture codes", () => {
  expect(DELIVERY_CASES.map(({ id }) => id)).toEqual(["delivery-complete", "delivery-missing-moisture", "delivery-split-bin"]);
  expect(DELIVERY_CASES[0].text(target)).toBe("Deliver 2.4 t wet of order OR-X from PB-1 at 31% moisture, yesterday 14:00");
  expect(DELIVERY_CASES[1].text(target)).toBe("Deliver 2.4 t wet of order OR-X from PB-1, today 14:00");
  expect(DELIVERY_CASES[2].text(splitTarget)).toBe("Deliver 2.4 t wet of order OR-X from PB-2, today 14:00");
  expect(DELIVERY_CASES[0].text({ orderCode: "OR-CUSTOM", binCode: "PB-CUSTOM" })).toContain("order OR-CUSTOM from PB-CUSTOM");
});
