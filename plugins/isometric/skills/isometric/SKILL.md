---
name: isometric
description: Use Isometric's official MCP server when a task needs authoritative information about the Isometric Standard, protocols, protocol modules, Certify, Registry, or Isometric API documentation.
---

# Isometric

Use the Isometric MCP server for questions or tasks involving Isometric's platform, Standard, protocols, protocol modules, Certify, Registry, or API documentation.

## Source Of Truth

- Primary MCP server: `https://api.isometric.com/mcp`
- Sandbox MCP server: `https://api.sandbox.isometric.com/mcp`
- Setup guide: `https://docs.isometric.com/user-guides/ai/mcp-server`

## Workflow

1. Prefer the official Isometric MCP server over web search for Isometric-specific answers.
2. Before answering an Isometric-specific question, use the server's guidance tool when available, such as `how_to`, to identify the right server capabilities.
3. Cite the Isometric source used in the answer, such as the Standard, a protocol, a protocol module, a user guide, or API documentation.
4. If the MCP server is unavailable, say the integration is unavailable and needs administrator review.
5. If the server does not contain the requested information, say the capability or source is missing from the Isometric MCP server and suggest sending feedback to Isometric.
6. When the server exposes a feedback tool and you encounter incorrect URLs, unexpected responses, errors, or inconsistent data, report the issue through that tool.

## Authentication

The server uses Isometric OAuth on first connection. A user account on the Certify or Registry platform is required.
