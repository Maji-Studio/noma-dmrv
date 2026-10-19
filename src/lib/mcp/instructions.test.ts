import { expect, it } from "vitest";
import { domainGuide, llmsGuide, oauthGuide } from "@/lib/api/llms-guide";
import { mcpInstructions } from "./instructions";

const OAUTH_GUIDANCE_MAX_CHARS = 250;

it("keeps the domain guidance; OAuth guidance lives in llms.txt, not the MCP instructions budget", () => {
  expect(domainGuide).toContain("not weighed for bin stock");
  expect(domainGuide).toContain("Resolve the reactor and bins in the run facility before writing.");
  expect(mcpInstructions).toContain("Call whoami first. Use find_* lookups for ids.");
  // A connected agent is already authorized; the 2,000-character MCP budget
  // stays for domain guidance (src/app/api/mcp/route.test.ts).
  expect(mcpInstructions).not.toContain(oauthGuide);
  expect(llmsGuide).toContain(oauthGuide);
  expect(oauthGuide.length).toBeLessThanOrEqual(OAUTH_GUIDANCE_MAX_CHARS);
});
