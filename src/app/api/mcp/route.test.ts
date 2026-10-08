import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/config/env", () => ({
  env: { NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "http://localhost:3100" },
}));

const ENDPOINT = "http://localhost:3100/api/mcp";
const LEGACY_PROTOCOL_VERSION = "2025-06-18";

function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": LEGACY_PROTOCOL_VERSION,
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

/** A JSON-RPC response body, whether sent as JSON or as one SSE event. */
async function body(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const data = text.trim().startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length))
        .join("");
  return JSON.parse(data);
}

describe("MCP route (Phase 0 spike)", () => {
  it("lists tools with the corrected operation contract", async () => {
    const response = await POST(rpc("tools/list"));
    expect(response.status).toBe(200);
    const { result } = (await body(response)) as {
      result: { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> };
    };

    const check = result.tools.find((tool) => tool.name === "check_feedstock_delivery");
    const properties = check?.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.deliveryDate).toEqual({
      type: "string", format: "date",
      description: "Facility-local delivery business date, YYYY-MM-DD, never an instant.",
    });
    expect(properties.totalWetMassKg).toMatchObject({
      type: "number",
      exclusiveMinimum: 0,
      multipleOf: 0.001,
    });
    expect(check?.inputSchema.required).not.toContain("transportDistanceKm");
  });

  it("refuses a browser request from another site", async () => {
    const response = await POST(rpc("tools/list", {}, { origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
  });

  it("answers invalid tool arguments with a tool error naming the field", async () => {
    const response = await POST(
      rpc("tools/call", {
        name: "check_feedstock_delivery",
        arguments: { deliveryDate: "2026-02-31" },
      }),
    );
    const { result, error } = (await body(response)) as {
      result?: { isError?: boolean; content: Array<{ text: string }> };
      error?: { code: number; message: string };
    };
    const message = result?.content[0]?.text ?? error?.message ?? "";
    expect(result?.isError ?? error !== undefined).toBe(true);
    expect(message).toContain("deliveryDate");
  });
});
