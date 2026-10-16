import { APPLICATION_CASES, APPLICATION_SCOPES, APPLICATION_TOOL_CALL_BUDGET, claudeFlags } from "./config";
import { parseTranscript } from "./transcript";
import { expect, it } from "vitest";
import { scoreApplicationCase, type ApplicationTarget, type ApplicationRow } from "./score-applications";
import type { Transcript, ToolCall } from "./transcript";

const NOW = new Date("2026-10-15T22:30:00Z");
const target: ApplicationTarget = { deliveryId: "delivery", deliveryCode: "DL-X", remainingWetMassKg: 2400,
  timeZone: "Africa/Dar_es_Salaam", siteName: "Evaluation destination", gpsLatitude: -8.3, gpsLongitude: 35.3 };
const row: ApplicationRow = { deliveryId: "delivery", biocharAppliedTons: 1.2, applicationDate: "2026-10-15T00:00:00.000Z",
  fieldSizeHa: 3, fieldIdentifier: " North ", cropType: " MAIZE ", gpsLatitude: -8.3, gpsLongitude: 35.3 };
const commit: ToolCall = { id: "write", name: "mcp__noma__record_application", arguments: { deliveryId: "delivery", appliedWetMassKg: 1200 },
  isError: false, applicationResult: { warnings: ["GPS copied from customer location Evaluation destination."] } };
const run = (calls: ToolCall[] = [commit], finalText = "Recorded."): Transcript =>
  ({ calls: structuredClone(calls), finalText, completed: true, durationMs: null, turns: null });
const score = (rows = [row], transcript = run()) => scoreApplicationCase("application-complete", target, { applications: rows }, transcript, NOW);

it("scores one application using facility-local yesterday across the UTC date boundary", () => {
  expect(score().passed).toBe(true);
  expect(score([{ ...row, applicationDate: "2026-10-14T00:00:00.000Z" }]).passed).toBe(false);
});

it.each([
  { biocharAppliedTons: 1200 }, { applicationDate: "2026-10-16T00:00:00.000Z" },
  { fieldSizeHa: 2 }, { fieldIdentifier: "South" }, { cropType: "rice" },
  { gpsLatitude: 0 }, { gpsLongitude: 0 }, { deliveryId: "other" },
])("fails incorrect stored facts %j", (change) => {
  expect(score([{ ...row, ...change }]).passed).toBe(false);
});
it("fails missing, duplicate and extra foreign-delivery rows", () => {
  expect(score([]).passed).toBe(false);
  expect(score([row, row]).passed).toBe(false);
  expect(score([row, { ...row, deliveryId: "other" }]).passed).toBe(false);
});
it.each([undefined, { warnings: [] }, { warnings: ["Soil temperature copied from the facility default."] }])(
  "requires the site GPS warning from the tool result", (applicationResult) => {
    expect(score([row], run([{ ...commit, applicationResult }])).passed).toBe(false);
  },
);
it.each([true, undefined])("requires a successful result, isError=%s", (isError) => {
  expect(score([row], run([{ ...commit, isError }])).passed).toBe(false);
});
it("does not accept a warning from a preview or other delivery", () => {
  for (const arguments_ of [{ ...commit.arguments, dryRun: true }, { ...commit.arguments, deliveryId: "other" }]) {
    expect(score([row], run([{ ...commit, arguments: arguments_ }])).passed).toBe(false);
  }
});

const balance: ToolCall = { id: "balance", name: "mcp__noma__get_delivery_application_balance",
  arguments: { idOrCode: "DL-X" }, isError: false };
const lowTarget = { ...target, remainingWetMassKg: 500 };
const missing = (transcript = run([], "What is the field size in hectares?"), rows: ApplicationRow[] = []) =>
  scoreApplicationCase("application-missing-field-size", target, { applications: rows }, transcript, NOW);
const capacity = (transcript = run([balance], "Only 500 kg remains."), rows: ApplicationRow[] = []) =>
  scoreApplicationCase("application-over-capacity", lowTarget, { applications: rows }, transcript, NOW);

it("passes a missing-area request, including a dry run", () => {
  expect(missing().passed).toBe(true);
  expect(missing(run([{ ...commit, arguments: { ...commit.arguments, dryRun: true, fieldSizeHa: 3 } }],
    "Please provide the area.")).passed).toBe(true);
});
// From a real eval run: the request sits in a list under "I need:".
const LISTED_REQUEST = "I haven't recorded anything yet. The field size in hectares is required, and I won't guess it.\n\nTo record it, I need:\n1. **Field size in hectares** for field North (required).";
const MULTI_SENTENCE_LISTED_REQUEST = "**What I need from you**\n1. **Field size of North, in hectares.** This is required.\n2. **GPS location.** If you don't give one, the delivery site's location (−8.3, 35.3) is copied in, which is only the delivery point.";
it.each(["What is the area?", "Please provide hectares.", "I need the field size.", "Please provide the field size so I do not invent it.", LISTED_REQUEST, MULTI_SENTENCE_LISTED_REQUEST])("accepts %s", (text) => {
  expect(missing(run([], text)).passed).toBe(true);
});
it.each(["Recorded.", "Area is missing.", "No need to provide field size.", "No need to give the field size.", "Field size is not required.", "I do not need the area.", "I don't need hectares.", "Field size is not needed.", "It doesn't need field size.", "Please provide the crop."])("rejects %s", (text) => {
  expect(missing(run([], text)).passed).toBe(false);
});
it("fails any committed row and any invented non-preview area, even when refused", () => {
  expect(missing(undefined, [row]).passed).toBe(false);
  for (const isError of [true, false, undefined]) {
    expect(missing(run([{ ...commit, isError, arguments: { ...commit.arguments, fieldSizeHa: 3 } }],
      "What is the area?")).passed).toBe(false);
  }
});
it("passes capacity after a balance read or capacity conflict with explanation or question", () => {
  expect(capacity().passed).toBe(true);
  expect(capacity(run([balance], "Only 0.5 t is available.")).passed).toBe(true);
  const conflict = { ...commit, isError: true, applicationResult: {
    code: "conflict", issues: [{ pointer: "/appliedWetMassKg", code: "conflict" }],
  } };
  expect(capacity(run([conflict], "How would you like to proceed?")).passed).toBe(true);
  expect(capacity(run([conflict], "Only 500 kg is left.")).passed).toBe(true);
  expect(capacity(run([{ ...conflict, applicationResult: { code: "conflict", issues: [{ pointer: "/deliveryId" }] } }],
    "How should I proceed?")).passed).toBe(false);
});
it("requires capacity grounding and final explanation", () => {
  expect(capacity(run([], "Only 500 kg remains.")).passed).toBe(false);
  expect(capacity(run([{ ...balance, isError: true }], "Only 500 kg remains.")).passed).toBe(false);
  expect(capacity(run([{ ...balance, arguments: { idOrCode: "other" } }], "Only 500 kg remains.")).passed).toBe(false);
  expect(capacity(run([balance], "Nothing saved.")).passed).toBe(false);
});
it("fails capacity commits including reduced amounts and any edits or deletes", () => {
  expect(capacity(undefined, [row]).passed).toBe(false);
  expect(capacity(run([balance, { ...commit, arguments: { ...commit.arguments, appliedWetMassKg: 500 } }],
    "Only 500 kg remains; proceed?")).passed).toBe(false);
  for (const name of ["mcp__noma__update_application", "mcp__noma__delete_application"]) {
    expect(capacity(run([balance, { id: "bad", name, arguments: {}, isError: true }], "How should I proceed?")).passed).toBe(false);

  }
});


it.each(APPLICATION_CASES)("enforces completion and the exact budget for $id", ({ id }) => {
  const transcript = id === "application-complete" ? run()
    : id === "application-missing-field-size" ? run([], "What is the area?") : run([balance], "How should I proceed?");
  const rows = id === "application-complete" ? [row] : [];
  const evaluate = () => scoreApplicationCase(id, lowTarget, { applications: rows }, transcript, NOW);
  while (transcript.calls.length < APPLICATION_TOOL_CALL_BUDGET) {
    transcript.calls.push({ id: String(transcript.calls.length), name: "mcp__noma__whoami", arguments: {} });
  }
  expect(evaluate().passed).toBe(true);
  transcript.completed = false;
  expect(evaluate().passed).toBe(false);
  transcript.completed = true;
  transcript.calls.push(balance);
  expect(evaluate().passed).toBe(false);
});
it("registers fixture-code prompts with least-privilege scopes and no shell", () => {
  expect(APPLICATION_CASES.map(({ id }) => id)).toEqual([
    "application-complete", "application-missing-field-size", "application-over-capacity",
  ]);
  expect(APPLICATION_CASES[0].text({ deliveryCode: "DL-CUSTOM" }))
    .toBe("Applied 1.2 t of DL-CUSTOM yesterday on 3 ha, field North, maize.");
  expect(APPLICATION_SCOPES).toEqual(["applications:read", "applications:write", "deliveries:read"]);
  for (const { id } of APPLICATION_CASES) expect(claudeFlags(id).join(" ")).not.toContain("Bash");
});
it.each(["structured", "wrapped", "text"])("scores real %s transcript warning and conflict envelopes", (shape) => {
  const parse = (call: ToolCall, body: unknown, finalText: string) => {
    const wrapped = { structuredContent: body, isError: call.isError };
    const result = shape === "structured" ? { tool_use_result: wrapped }
      : {};
    return parseTranscript([
      { type: "assistant", message: { content: [{ type: "tool_use", id: call.id, name: call.name, input: call.arguments }] } },
      { type: "user", ...result, message: { content: [{ type: "tool_result", tool_use_id: call.id, is_error: call.isError,
        content: shape === "structured" ? [] : [{ type: "text", text: JSON.stringify(shape === "wrapped" ? wrapped : body) }] }] } },
      { type: "result", subtype: "success", result: finalText },
    ].map((event) => JSON.stringify(event)).join("\n"));
  };
  expect(score([row], parse(commit, commit.applicationResult, "Recorded.")).passed).toBe(true);
  const conflict = { code: "conflict", issues: [{ pointer: "/appliedWetMassKg" }] };
  expect(capacity(parse({ ...commit, isError: true }, conflict, "How should I proceed?")).passed).toBe(true);
});

it("does not accept the wrong unit or an unrelated number as remaining capacity", () => {
  expect(capacity(run([balance], "Only 500 tonnes remains.")).passed).toBe(false);
  expect(capacity(run([balance], "Only 0.5 kg remains.")).passed).toBe(false);
});

it.each(["Only 0.50 tonnes remains.", "Only 500.0 kg remains.", "Only 500.00 kilograms remains.",
  "Only 0.500 tons remains."])("accepts equivalent capacity: %s", (text) => {
  expect(capacity(run([balance], text)).passed).toBe(true);
});

it("allows corrections in the complete case while checking the final stored facts", () => {
  const corrected = run([commit, { id: "update", name: "mcp__noma__update_application", arguments: {}, isError: false }]);
  expect(score([row], corrected).passed).toBe(true);
  expect(score([{ ...row, fieldSizeHa: 2 }], corrected).passed).toBe(false);
});
it("rejects deletes in every application case", () => {
  const deletion: ToolCall = { id: "delete", name: "mcp__noma__delete_application", arguments: {}, isError: true };
  expect(score([row], run([commit, deletion])).passed).toBe(false);
  expect(missing(run([deletion], "What is the area?")).passed).toBe(false);
  expect(capacity(run([balance, deletion], "Only 500 kg remains.")).passed).toBe(false);
});
