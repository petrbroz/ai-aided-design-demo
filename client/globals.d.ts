declare const Autodesk: any;

/** WebMCP — https://github.com/webmachinelearning/webmcp */
interface WebMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface WebMcpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: any) => Promise<WebMcpToolResult>;
}

interface WebMcpModelContext {
  registerTool(
    tool: WebMcpToolDescriptor,
    options?: { signal?: AbortSignal }
  ): Promise<unknown> | unknown;
}

interface Document {
  modelContext?: WebMcpModelContext;
}

interface Navigator {
  /** Deprecated in Chromium 150 in favour of `document.modelContext`. */
  modelContext?: WebMcpModelContext;
}
