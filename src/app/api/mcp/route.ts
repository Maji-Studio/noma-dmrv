/**
 * MCP endpoint, Phase 0 interop spike (data-entry API plan, section 5).
 *
 * No credential is checked yet, so this route serves only tools that read no
 * organization data, and it answers 404 in production builds (staging
 * included). Phase 3 replaces it with bearer API keys and the
 * `feedstock-intake` toolset.
 *
 * `mcp-handler` 2.x serves the 2026-07-28 revision statelessly and falls back
 * to stateless Streamable HTTP for 2025-era clients. It does not validate
 * `Origin`, so this route does: a browser page on another site gets 403 even
 * if it could attach a credential. Non-browser clients send no `Origin`.
 */

import { createMcpHandler } from "mcp-handler";
import {
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { createFeedstockSchema } from "@/schemas/feedstocks";
import { toToolSchema } from "@/lib/operations/mcp-schema";

export const runtime = "nodejs";

const SERVER_INFO = { name: "noma-dmrv", version: "0.0.0-spike" };

function allowedOriginHostnames(): string[] {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const hostnames = localhostAllowedOrigins();
  if (appUrl) hostnames.push(new URL(appUrl).hostname);
  return hostnames;
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "ping",
      {
        title: "Ping",
        description: "Check that the noma-dmrv MCP server is reachable. Reads no data.",
        inputSchema: z.object({}),
        outputSchema: z.object({ status: z.literal("ok"), serverTime: z.string() }),
        annotations: { readOnlyHint: true },
      },
      async () => {
        const structuredContent = { status: "ok" as const, serverTime: new Date().toISOString() };
        return {
          content: [{ type: "text", text: `noma-dmrv is reachable (${structuredContent.serverTime}).` }],
          structuredContent,
        };
      },
    );

    server.registerTool(
      "check_feedstock_delivery",
      {
        title: "Check a feedstock delivery",
        description:
          "Validate a feedstock delivery against the log_feedstock_delivery input rules without saving or reading anything. Masses are wet kg; deliveryDate is the facility's calendar day (YYYY-MM-DD); moisturePercent is 0 to 100.",
        inputSchema: toToolSchema(createFeedstockSchema),
        annotations: { readOnlyHint: true },
      },
      async (delivery) => ({
        content: [
          {
            type: "text",
            text: `Valid: ${delivery.allocations.length} bin allocation(s), ${delivery.totalWetMassKg} kg wet, delivered ${delivery.deliveryDate.toISOString().slice(0, 10)}.`,
          },
        ],
      }),
    );
  },
  { serverInfo: SERVER_INFO },
);

async function handler(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  const rejected = originValidationResponse(request, allowedOriginHostnames());
  if (rejected) return rejected;
  return mcpHandler(request);
}

export { handler as GET, handler as POST, handler as DELETE };
