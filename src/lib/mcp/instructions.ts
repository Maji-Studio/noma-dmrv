import { domainGuide } from "@/lib/api/llms-guide";
import { REQUEST_KEY_RULE } from "@/lib/operations/agent-guidance";

export const mcpInstructions = `${domainGuide}
## MCP requests

- Call whoami first. Use find_* lookups for ids.
- ${REQUEST_KEY_RULE}
- Use expectedVersion from get_feedstock for updates and deletes.
- Follow retryable on errors.
`;
