export type McpAttachmentRoute = 'dispatch' | 'legacy';

/** One tier decision for the native/dispatch MCP attachment contract. */
export function chooseMcpAttachmentRoute(input: {
  dispatchEnabled: boolean;
  poolAvailable: boolean;
}): McpAttachmentRoute {
  return input.dispatchEnabled && input.poolAvailable ? 'dispatch' : 'legacy';
}
