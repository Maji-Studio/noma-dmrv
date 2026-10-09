import { expect, it } from "vitest";
import { parseTranscript, redactKeys } from "./transcript";

it("keeps ordered MCP calls, arguments, error flags and final run metrics", () => {
  const events = [
    { type: "system", subtype: "init" },
    { type: "assistant", message: { content: [
      { type: "tool_use", id: "one", name: "mcp__noma__whoami", input: {} },
      { type: "tool_use", id: "two", name: "mcp__noma__log_feedstock_delivery", input: { dryRun: true } },
    ] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "one", is_error: false }] }, tool_use_result: { isError: false } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "two", is_error: false }] }, tool_use_result: { isError: true } },
    { type: "result", subtype: "success", is_error: false, result: "What is the moisture percentage?", num_turns: 3, duration_ms: 1234 },
  ];
  expect(parseTranscript(events.map((event) => JSON.stringify(event)).join("\n"))).toEqual({
    calls: [
      { id: "one", name: "mcp__noma__whoami", arguments: {}, isError: false },
      { id: "two", name: "mcp__noma__log_feedstock_delivery", arguments: { dryRun: true }, isError: true },
    ],
    finalText: "What is the moisture percentage?", turns: 3, durationMs: 1234, completed: true,
  });
});

it("redacts exact issued keys and key-shaped text wherever it occurs", () => {
  expect(redactKeys('Bearer fixture-secret; {"key":"fixture-secret"}; noma_live_leaked123', ["fixture-secret"]))
    .toBe('Bearer [REDACTED]; {"key":"[REDACTED]"}; [REDACTED]');
});

it("counts repeated calls with different ids but ignores duplicated assistant messages and other tools", () => {
  const message = { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "mcp__noma__whoami", input: {} }] } };
  const second = { type: "assistant", message: { content: [
    { type: "tool_use", id: "b", name: "mcp__noma__whoami", input: {} },
    { type: "tool_use", id: "c", name: "Bash", input: {} },
  ] } };
  const parsed = parseTranscript([message, message, second].map((event) => JSON.stringify(event)).join("\n"));
  expect(parsed.calls.map((call) => call.id)).toEqual(["a", "b"]);
  expect(parsed.completed).toBe(false);
});

it("recognizes MCP isError inside JSON tool content and refuses malformed transcripts", () => {
  const events = [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "mcp__noma__whoami", input: {} }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: [{ type: "text", text: '{"isError":true}' }] }] } },
    { type: "result", subtype: "error_during_execution", is_error: true },
  ];
  const parsed = parseTranscript(events.map((event) => JSON.stringify(event)).join("\n"));
  expect(parsed.calls[0].isError).toBe(true);
  expect(parsed.completed).toBe(false);
  expect(() => parseTranscript("not-json")).toThrow("invalid stream-json");
});

it("preserves the call count when an interrupted stream ends with a partial event", () => {
  const call = { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "mcp__noma__whoami", input: {} }] } };
  const parsed = parseTranscript(`${JSON.stringify(call)}\n{"type":`, true);
  expect(parsed.calls).toHaveLength(1);
  expect(parsed.completed).toBe(false);
});
