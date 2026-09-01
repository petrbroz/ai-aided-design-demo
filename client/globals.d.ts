/**
 * Minimal ambient declarations. The APS Viewer SDK and THREE are loaded from the
 * CDN as globals; `webmcp-types` is not depended on so the build never breaks on
 * an experimental package. Typed loosely on purpose — this is a demo.
 */

declare const Autodesk: any;
declare const THREE: any;

/** WebMCP — https://github.com/webmachinelearning/webmcp */
interface WebMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
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
