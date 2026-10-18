import { domainGuide, oauthGuide } from "@/lib/api/llms-guide";
import { REQUEST_KEY_RULE, STOCK_EFFECTS_RULE } from "@/lib/operations/agent-guidance";

export const mcpInstructions = `${domainGuide}
${oauthGuide}

## MCP requests

- Call whoami first.
- ${REQUEST_KEY_RULE} ${STOCK_EFFECTS_RULE}
- Use expectedVersion from the resource get_* tool for updates and deletes.
- Follow retryable on errors.
`;
