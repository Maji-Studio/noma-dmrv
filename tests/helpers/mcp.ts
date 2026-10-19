export function rpc(key: string, method: string, params: Record<string, unknown> = {}) {
  return new Request("http://localhost:3100/api/mcp", { method: "POST", headers: {
    authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
export async function rpcBody(response: Response) {
  const text = await response.text();
  return JSON.parse(text.trim().startsWith("{") ? text : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length)).join(""));
}
