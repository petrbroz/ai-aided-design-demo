/**
 * Minimal ambient declarations. The APS Viewer SDK is loaded from the CDN as a
 * global; `webmcp-types` is not depended on so the build never breaks on an
 * experimental package. Typed loosely on purpose — this is a demo.
 *
 * The SDK still publishes a `THREE` global, but as of v7.120/7.122 its math types
 * are just aliases of `Autodesk.Viewing.Math`, which is what this app uses — so
 * `THREE` is deliberately not declared here.
 */

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
