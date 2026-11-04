export const TOOL_TEXT_SEPARATOR = "\n\n";

/** MCP text wire format: summary, blank line, compact JSON. */
export function toolText(summary: string, body: Record<string, unknown>): string {
  return `${summary}${TOOL_TEXT_SEPARATOR}${JSON.stringify(body)}`;
}
