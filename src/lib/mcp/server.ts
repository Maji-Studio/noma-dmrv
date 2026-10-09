import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { API_VERSION } from "@/config/api-rest";
import type { ApiRouteContext } from "@/lib/api/route";
import { hasRoleAndScope } from "@/lib/auth/api-scopes";
import { deadlineExceeded } from "@/lib/domain-errors";
import { toToolSchema } from "@/lib/operations/mcp-schema";
import { meRepresentationSchema } from "@/lib/representations/me";
import { feedstockRepresentationSchema } from "@/lib/representations/feedstocks";
import { readTools, type ReadTool } from "./tools/read-tools";
import { toolErrorSchema, toolFailure, toolSuccess } from "./results";

/** Phase 3b changes this classifier when write tools are introduced. */
export function mcpRequestAccess(_body: unknown): "read" | "write" {
  void _body;
  return "read";
}

function summary(tool: ReadTool, body: Record<string, unknown>): string {
  if (Array.isArray(body.data)) return `${body.data.length} ${tool.noun}.${body.nextCursor ? " More results: pass nextCursor." : ""}`;
  if (tool.name === "whoami") {
    const data = body.data as z.infer<typeof meRepresentationSchema>;
    return `${tool.noun} ${data.organization.name}, ${data.facilities.length} facilities, role ${data.role}.`;
  }
  const data = body.data as z.infer<typeof feedstockRepresentationSchema>;
  return `${tool.noun} ${data.code}, version ${data.version}.`;
}

export function serveMcp(request: Request, context: ApiRouteContext): Promise<Response> {
  const tools = new Map(readTools.filter((tool) => !tool.scope || hasRoleAndScope(context.ctx, tool.scope))
    .map((tool) => [tool.name, tool]));
  const handler = createMcpHandler((server) => {
    for (const tool of tools.values()) {
      server.registerTool(tool.name, {
        description: tool.description, inputSchema: toToolSchema(tool.input),
        outputSchema: toToolSchema(z.union([tool.output, toolErrorSchema])),
        annotations: { readOnlyHint: true },
      }, async () => { throw new Error("The request dispatcher owns tool execution."); });
    }
    // The high-level SDK catches every tool exception and emits text-only errors.
    // Dispatch here so our Zod parsing and protocol errors retain their wire shapes.
    server.server.setRequestHandler("tools/call", async (rpc) => {
      const tool = tools.get(rpc.params.name);
      if (!tool) throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Unknown tool.");
      try {
        if (Date.now() >= context.deadlineAt) throw deadlineExceeded("before starting");
        const body = await tool.execute(context.ctx, rpc.params.arguments ?? {});
        // A broken reader is an internal error, never an input validation failure.
        tool.output.parse(body);
        return toolSuccess(body, summary(tool, body));
      } catch (error) {
        return toolFailure(error, context, tool.name);
      }
    });
  }, { serverInfo: { name: "noma-dmrv", version: API_VERSION } });
  return handler(request);
}
