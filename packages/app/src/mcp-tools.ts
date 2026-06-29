import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentTool, ToolResult } from "@zer-agent/agent-core";
import type { AppConfig, McpServerConfig } from "./config.js";

export type McpRuntime = {
  tools: AgentTool[];
  statuses: McpServerStatus[];
  close: () => Promise<void>;
};

export type McpServerStatus = {
  name: string;
  command: string;
  toolCount: number;
  error?: string;
};

type ConnectedMcpServer = {
  name: string;
  client: Client;
  transport: StdioClientTransport;
};

export async function createMcpRuntime(config: AppConfig, cwd: string): Promise<McpRuntime> {
  const connectedServers: ConnectedMcpServer[] = [];
  const tools: AgentTool[] = [];
  const statuses: McpServerStatus[] = [];

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    try {
      const connected = await connectMcpServer(name, serverConfig, cwd);
      connectedServers.push(connected);
      const listedTools = await connected.client.listTools();
      statuses.push({
        name,
        command: serverConfig.command,
        toolCount: listedTools.tools.length
      });
      for (const tool of listedTools.tools) {
        tools.push(toAgentTool(connected.client, name, tool));
      }
    } catch (error: unknown) {
      statuses.push({
        name,
        command: serverConfig.command,
        toolCount: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    tools,
    statuses,
    async close() {
      await Promise.allSettled(connectedServers.map((server) => server.transport.close()));
    }
  };
}

export function formatMcpStatus(statuses: McpServerStatus[]): string {
  if (statuses.length === 0) {
    return "No MCP servers configured.";
  }

  return statuses
    .map((status) => status.error
      ? `${status.name}: failed (${status.error})`
      : `${status.name}: connected (${status.toolCount} tools)`)
    .join("\n");
}

async function connectMcpServer(name: string, serverConfig: McpServerConfig, cwd: string): Promise<ConnectedMcpServer> {
  const client = new Client({ name: "zer-agent", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    env: serverConfig.env ? { ...process.env, ...serverConfig.env } as Record<string, string> : undefined,
    cwd,
    stderr: "pipe"
  });
  await client.connect(transport);
  return { name, client, transport };
}

function toAgentTool(client: Client, serverName: string, tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }): AgentTool {
  return {
    name: `mcp_${sanitizeToolName(serverName)}_${sanitizeToolName(tool.name)}`,
    description: `[MCP ${serverName}] ${tool.description ?? tool.name}`,
    permissionCategory: "network",
    input: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
    async execute(args) {
      const result = await client.callTool({
        name: tool.name,
        arguments: args
      });
      return normalizeMcpToolResult(result as { content?: Array<Record<string, unknown>>; isError?: boolean });
    }
  };
}

function normalizeMcpToolResult(result: { content?: Array<Record<string, unknown>>; isError?: boolean }): ToolResult {
  const content = result.content?.map((item) => {
    if (item.type === "text" && typeof item.text === "string") {
      return item.text;
    }
    return JSON.stringify(item);
  }).join("\n") ?? "(empty MCP result)";

  return {
    content,
    isError: result.isError
  };
}

function sanitizeToolName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}
