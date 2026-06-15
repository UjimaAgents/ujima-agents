/**
 * Neutral type-only module: every consumer can `import type` this
 * without ever pulling in a runtime side from a sibling module.
 */
export type AttachmentCaptureClosure = (input: {
  organizationId: string;
  runId: string;
  memberId: string;
  serverId: string;
  toolName: string;
  toolCallId: string;
  toolResult: unknown;
}) => {
  attachmentRefs: { ref: string; category: string; filename: string; byteSize: number }[];
};
