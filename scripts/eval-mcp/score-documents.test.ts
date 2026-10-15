import { expect, it } from "vitest";
import { claudeFlags, CLAUDE_FLAGS, DOCUMENT_CASES, DOCUMENT_DELIVERY_CODE, DOCUMENT_TOOL_CALL_BUDGET } from "./config";
import { billOfLadingPdf } from "./fixture-document-file";
import { scoreDocumentCase, type DocumentDatabaseSnapshot, type DocumentTarget } from "./score-documents";
import { parseTranscript, type ToolCall, type Transcript } from "./transcript";
import { createHash } from "node:crypto";

const pdf = billOfLadingPdf();
const target: DocumentTarget = { deliveryId: "delivery-id", deliveryCode: DOCUMENT_DELIVERY_CODE,
  filePath: "/tmp/eval-fixture/bol.pdf", sha256: createHash("sha256").update(pdf).digest("hex"), sizeBytes: pdf.length };
const DOCUMENT_ID = "document-id";
const request: ToolCall = { id: "request", name: "mcp__noma__request_document_upload", isError: false,
  arguments: { ownerType: "delivery", ownerId: target.deliveryCode, documentType: "bill_of_lading",
    fileName: "bol.pdf", contentType: "application/pdf", sizeBytes: target.sizeBytes, sha256: target.sha256, requestKey: "upload-key" } };
const confirm: ToolCall = { id: "confirm", name: "mcp__noma__confirm_document_upload", isError: false,
  arguments: { ownerType: "delivery", ownerId: target.deliveryId, documentId: DOCUMENT_ID } };

function saved(): DocumentDatabaseSnapshot {
  return { documents: [{ id: DOCUMENT_ID, entityType: "delivery", entityId: target.deliveryId,
    documentType: "bill_of_lading", uploadStatus: "uploaded", checksumSha256: target.sha256 }],
    audits: ["request_document_upload", "confirm_document_upload"].map((operationId) => ({ operationId,
      transport: "mcp", entityType: "document", entityIds: [DOCUMENT_ID] })), deliveryUnchanged: true };
}
function run(): Transcript {
  return { calls: structuredClone([request, confirm]), completed: true, finalText: "Attached.", durationMs: 1000, turns: 3,
    shellCalls: [{ id: "put", name: "Bash", arguments: { command: `curl -T ${target.filePath} -H 'Content-Type: application/pdf' '<upload-url>'` }, isError: false }] };
}
const score = (state = saved(), transcript = run()) => scoreDocumentCase(target, state, transcript);

it("passes one uploaded bill of lading with the fixture hash, accepting code or UUID owners", () => {
  expect(score().passed).toBe(true);
  const transcript = run();
  transcript.calls[0].arguments.ownerId = target.deliveryId;
  transcript.calls[1].arguments.ownerId = target.deliveryCode;
  expect(score(saved(), transcript).passed).toBe(true);
});

it.each(["pdf", "photo", "other"])("fails a %s document or upload attempt, even if later corrected", (documentType) => {
  const state = saved();
  state.documents[0].documentType = documentType;
  expect(score(state).criteria.type).toBe(false);
  expect(score(state).passed).toBe(false);
  const transcript = run();
  transcript.calls.unshift({ ...request, id: "bad-type", isError: true, arguments: { ...request.arguments, documentType } });
  expect(score(saved(), transcript).passed).toBe(false);
});

it.each(["failed", "pending", "uploaded"])("fails an additional %s row on the delivery", (uploadStatus) => {
  const state = saved();
  state.documents.push({ ...state.documents[0], id: "extra", uploadStatus });
  expect(score(state).criteria.rows).toBe(false);
  expect(score(state).passed).toBe(false);
});

it("fails a document or an upload on another owner, including a second document elsewhere", () => {
  for (const change of [{ entityType: "feedstock" }, { entityId: "other-delivery" }]) {
    const state = saved();
    Object.assign(state.documents[0], change);
    expect(score(state).passed).toBe(false);
  }
  const extra = saved();
  extra.documents.push({ ...extra.documents[0], id: "extra", entityId: "other-delivery" });
  expect(score(extra).passed).toBe(false);
  for (const callIndex of [0, 1]) {
    const transcript = run();
    transcript.calls[callIndex].arguments.ownerId = "other-delivery";
    expect(score(saved(), transcript).passed).toBe(false);
  }
});

it("fails a wrong checksum or a missing document", () => {
  const wrong = saved();
  wrong.documents[0].checksumSha256 = "wrong";
  expect(score(wrong).passed).toBe(false);
  expect(score({ ...saved(), documents: [] }).passed).toBe(false);
});

it.each([
  { base64: pdf.toString("base64") },
  { fileBytes: [...pdf] },
  { content: "%PDF-1.4" },
  { description: pdf.toString("base64") },
  { description: pdf.toString("hex") },
  { description: "data:application/pdf;base64,JVBERi0=" },
  { description: "[37,80,68,70,45,49,46,52,10]" },
  { nested: { description: JSON.stringify([...pdf]) } },
  { description: [37, 80, 68, 70] },
  { description: " [37, 80, 68, 70] " },
  { description: Array.from({ length: 9 }, (_, index) => index) },
  { description: JSON.stringify(Array.from({ length: 9 }, (_, index) => index)) },
  { nested: { body: [1, 2, 3] } },
])("fails file bytes in any MCP argument, including refused attempts: %j", (payload) => {
  const transcript = run();
  transcript.calls.unshift({ id: "bytes", name: "mcp__noma__whoami", arguments: payload, isError: true });
  expect(score(saved(), transcript).criteria.noFileBytesInMcp).toBe(false);
  expect(score(saved(), transcript).passed).toBe(false);
});

it.each([
  [], [1, 2, 3], Array.from({ length: 8 }, (_, index) => index),
  [...Array(8).fill(1), -1], [...Array(8).fill(1), 256], [...Array(8).fill(1), 1.5],
  [...Array(8).fill(1), "2"], "[37,80,68,70", "plain description",
].map((value) => ({ value })))("accepts ordinary metadata rather than treating it as a byte array: %j", ({ value }) => {
  for (const description of [value, JSON.stringify(value)]) {
    const transcript = run();
    transcript.calls[0].arguments.description = description;
    expect(score(saved(), transcript).criteria.noFileBytesInMcp).toBe(true);
  }
});

it("accepts exactly six MCP calls and excludes successful Bash calls from the budget", () => {
  const transcript = run();
  while (transcript.calls.length < DOCUMENT_TOOL_CALL_BUDGET) {
    transcript.calls.push({ id: String(transcript.calls.length), name: "mcp__noma__whoami", arguments: {} });
  }
  transcript.shellCalls!.push(...Array.from({ length: DOCUMENT_TOOL_CALL_BUDGET }, (_, index) => ({
    id: `shell-${index}`, name: "Bash", arguments: { command: "wc -c bol.pdf" }, isError: false,
  })));
  expect(score(saved(), transcript)).toMatchObject({ passed: true, toolCalls: DOCUMENT_TOOL_CALL_BUDGET });
  transcript.calls.push({ id: "extra", name: "mcp__noma__whoami", arguments: {} });
  expect(score(saved(), transcript).criteria.budget).toBe(false);
  expect(score(saved(), transcript).passed).toBe(false);
});

it("fails when confirm never ran and the document stays pending", () => {
  const state = saved();
  state.documents[0].uploadStatus = "pending";
  state.documents[0].checksumSha256 = null;
  state.audits.pop();
  const transcript = run();
  transcript.calls.pop();
  expect(score(state, transcript)).toMatchObject({ passed: false, criteria: { uploaded: false, confirmed: false } });
});

it("requires a successful confirm and shell call, and a completed session", () => {
  const missing = run();
  missing.calls.pop();
  expect(score(saved(), missing).passed).toBe(false);
  const refused = run();
  refused.calls[1].isError = true;
  expect(score(saved(), refused).passed).toBe(false);
  for (const transcript of [{ ...run(), shellCalls: [] }, { ...run(), completed: false }]) {
    expect(score(saved(), transcript).passed).toBe(false);
  }
});

it("fails unrelated committed writes, wrong document audit effects and an edited delivery", () => {
  for (const audit of [
    { operationId: "update_delivery", entityType: "delivery", entityIds: [target.deliveryId], transport: "mcp" },
    { operationId: "record_order", entityType: "order", entityIds: ["order"], transport: "rest" },
    { operationId: "request_document_upload", entityType: "document", entityIds: ["other-document"], transport: "mcp" },
  ]) {
    const state = saved();
    state.audits.push(audit);
    expect(score(state).criteria.noOtherWrites).toBe(false);
    expect(score(state).passed).toBe(false);
  }
  expect(score({ ...saved(), deliveryUnchanged: false }).passed).toBe(false);
  expect(score({ ...saved(), audits: [] }).passed).toBe(false);
});

it("scores actual stream-json with Bash kept outside the MCP calls", () => {
  const transcript = run();
  const events = [request, transcript.shellCalls![0], confirm].flatMap((call) => [
    { type: "assistant", message: { content: [{ type: "tool_use", id: call.id, name: call.name, input: call.arguments }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: call.id, is_error: false }] } },
  ]);
  const parsed = parseTranscript([...events, { type: "result", subtype: "success", result: "Attached." }]
    .map((event) => JSON.stringify(event)).join("\n"));
  expect(parsed.calls).toHaveLength(2);
  expect(parsed.shellCalls).toHaveLength(1);
  expect(score(saved(), parsed)).toMatchObject({ passed: true, toolCalls: 2 });
});

it("registers the exact case name and enables Bash only for this session", () => {
  expect(DOCUMENT_CASES.map(({ id }) => id)).toEqual(["delivery-bol-upload"]);
  expect(DOCUMENT_CASES[0].text(target)).toBe(`Attach the bill of lading at ${target.filePath} to delivery ${target.deliveryCode}.`);
  const fileDirectory = "/tmp/eval-fixture";
  const flags = claudeFlags("delivery-bol-upload", fileDirectory);
  expect(flags[flags.indexOf("--tools") + 1]).toBe("Bash");
  expect(flags[flags.indexOf("--allowedTools") + 1]).toBe("mcp__noma,Bash");
  expect(flags[flags.indexOf("--add-dir") + 1]).toBe(fileDirectory);
  expect(claudeFlags("delivery-complete", fileDirectory)).toEqual(CLAUDE_FLAGS);
});
