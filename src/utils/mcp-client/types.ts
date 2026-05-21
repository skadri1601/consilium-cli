export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: "stdio";
  enabled?: boolean;
}

export interface McpServersFile {
  servers: Record<string, Omit<McpServerConfig, "name">>;
}

export class McpClientError extends Error {
  readonly serverName: string;
  readonly code?: number;
  constructor(serverName: string, message: string, code?: number) {
    super(`[${serverName}] ${message}`);
    this.name = "McpClientError";
    this.serverName = serverName;
    this.code = code;
  }
}
