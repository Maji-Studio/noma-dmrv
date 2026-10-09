import { env } from "@/config/env";
import { ApiHttpError } from "@/lib/api/http-error";
import { writeTools } from "./tools/write-tools";
import { createMcpHandler } from "mcp-handler";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { API_VERSION } from "@/config/api-rest";
import type { ApiRouteContext } from "@/lib/api/route";
import { hasRoleAndScope } from "@/lib/auth/api-scopes";
import { deadlineExceeded } from "@/lib/domain-errors";
import { toToolSchema } from "@/lib/operations/mcp-schema";
import { readTools } from "./tools/read-tools";
import { toolOutputSchema, toolFailure, toolSuccess } from "./results";

const writeNames = new Set(writeTools.map((tool) => tool.name));

export function mcpRequestAccess(body: unknown): "read" | "write" {
  if (!body || typeof body !== "object" || !("method" in body) || body.method !== "tools/call"
    || !("params" in body) || !body.params || typeof body.params !== "object"
    || !("name" in body.params) || typeof body.params.name !== "string") return "read";
  return writeNames.has(body.params.name) ? "write" : "read";
}

export function serveMcp(request: Request, context: ApiRouteContext): Promise<Response> {
  const tools = new Map([...readTools, ...writeTools].filter((tool) => !tool.scope || hasRoleAndScope(context.ctx, tool.scope))
    .map((tool) => [tool.name, tool]));
  const handler = createMcpHandler((server) => {
    for (const tool of tools.values()) {
      server.registerTool(tool.name, {
        description: tool.description, inputSchema: toToolSchema(tool.input),
        outputSchema: toolOutputSchema(tool.output),
        annotations: "annotations" in tool ? tool.annotations : { readOnlyHint: true },
      }, async () => { throw new Error("The request dispatcher owns tool execution."); });
    }
    // The high-level SDK catches every tool exception and emits text-only errors.
    // Dispatch here so our Zod parsing and protocol errors retain their wire shapes.
    server.server.setRequestHandler("tools/call", async (rpc) => {
      const tool = tools.get(rpc.params.name);
      if (!tool) throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Unknown tool.");
      try {
        if (Date.now() >= context.deadlineAt) throw deadlineExceeded("before starting");
        if ("annotations" in tool) {
          if (env.API_WRITES_DISABLED) throw new ApiHttpError(503, "api_writes_disabled", "API writes are temporarily disabled.");
          const result = await tool.execute(context, rpc.params.arguments ?? {});
          tool.output.parse(result.body);
          return toolSuccess(result.body, `${result.replayed ? "Replayed: " : ""}${tool.summarize(result.body, result.dryRun)}`);
        }
        const body = await tool.execute(context.ctx, rpc.params.arguments ?? {});
        // A broken reader is an internal error, never an input validation failure.
        tool.output.parse(body);
        return toolSuccess(body, tool.summarize(body));
      } catch (error) {
        return toolFailure(error, context, tool.name);
      }
    });
  }, { serverInfo: { name: "noma-dmrv", version: API_VERSION } });
  return handler(request);
}
