import { API_KEY_LIVE_PREFIX, API_KEY_TEST_PREFIX } from "@/config/api-keys";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  isError?: boolean;
}
export interface Transcript {
  calls: ToolCall[];
  finalText: string;
  turns: number | null;
  durationMs: number | null;
  completed: boolean;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function resultHasError(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(resultHasError);
  const result = object(value);
  if (result.isError === true || result.is_error === true) return true;
  if (typeof result.text === "string") {
    try { return resultHasError(JSON.parse(result.text)); } catch { /* Plain result text. */ }
  }
  return Array.isArray(result.content) && result.content.some(resultHasError);
}

/** Full assistant/user messages, not partial stream deltas, carry tool calls. */
export function parseTranscript(raw: string, allowIncomplete = false): Transcript {
  const transcript: Transcript = { calls: [], finalText: "", turns: null, durationMs: null, completed: false };
  const callsById = new Map<string, ToolCall>();
  const lines = raw.split("\n").filter((line) => line.trim());
  for (const [index, line] of lines.entries()) {
    let event: Record<string, unknown>;
    try { event = object(JSON.parse(line)); }
    catch {
      if (allowIncomplete && index === lines.length - 1) { transcript.completed = false; break; }
      throw new Error("Claude produced invalid stream-json. Inspect the redacted transcript.");
    }
    const content = object(event.message).content;
    if (Array.isArray(content)) for (const value of content) {
      const block = object(value);
      if (event.type === "assistant" && block.type === "tool_use" && typeof block.name === "string"
        && block.name.startsWith("mcp__noma__") && typeof block.id === "string" && !callsById.has(block.id)) {
        const call = { id: block.id, name: block.name, arguments: object(block.input) };
        transcript.calls.push(call);
        callsById.set(call.id, call);
      }
      if (event.type === "user" && block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const call = callsById.get(block.tool_use_id);
        if (call) call.isError = resultHasError(block) || resultHasError(event.tool_use_result);
      }
    }
    if (event.type === "result") {
      transcript.finalText = typeof event.result === "string" ? event.result : "";
      transcript.turns = typeof event.num_turns === "number" ? event.num_turns : null;
      transcript.durationMs = typeof event.duration_ms === "number" ? event.duration_ms : null;
      transcript.completed = event.subtype === "success" && event.is_error !== true;
    }
  }
  return transcript;
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KEY_PATTERN = new RegExp(`(?:${escapePattern(API_KEY_LIVE_PREFIX)}|${escapePattern(API_KEY_TEST_PREFIX)})[A-Za-z0-9_-]+`, "g");

export function redactKeys(text: string, keys: readonly string[] = []): string {
  for (const key of keys.filter(Boolean)) text = text.split(key).join("[REDACTED]");
  return text.replace(KEY_PATTERN, "[REDACTED]");
}
