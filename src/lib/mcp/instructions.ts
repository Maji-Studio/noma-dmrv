import { domainGuide } from "@/lib/api/llms-guide";
import { REQUEST_KEY_RULE } from "./tools/descriptions";

export const mcpInstructions = `${domainGuide}
## MCP requests

- Call whoami first. Use find_* lookups for ids.
- ${REQUEST_KEY_RULE}
- Use expectedVersion from get_feedstock for updates and deletes.
- Follow retryable on errors.
`;
