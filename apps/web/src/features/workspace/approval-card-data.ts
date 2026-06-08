import {
  parseApprovalDisplayScopesFromReason,
  parseApprovalReasonValue,
  type ApprovalRequest,
  type Member,
} from "@ujima/shared/browser";
import type { ApprovalCardData } from "./components/chat";

export function approvalToCard(
  approval: ApprovalRequest,
  state: { members: Member[] },
): ApprovalCardData {
  const requestedBy =
    state.members.find((member) => member.id === approval.requestedBy)?.name ?? approval.requestedBy;
  const {
    shell: shellParsed,
    filesystem: fsParsed,
    connector: connectorParsed,
  } = parseApprovalDisplayScopesFromReason(approval.reason);
  const note = parseApprovalReasonValue(approval.reason, "note");
  const actionLabel = approval.action
    ? `${approval.action}${approval.resourcePath ? ` · \`${approval.resourcePath}\`` : ""}`
    : approval.resourcePath
      ? `\`${approval.resourcePath}\``
      : "";
  let title = approval.status === "pending" ? "Approve action" : `Approval ${approval.status}`;
  const description = note ?? actionLabel;
  let shellScope: ApprovalCardData["shellScope"];
  let filesystemScope: ApprovalCardData["filesystemScope"];
  let connectorScope: ApprovalCardData["connectorScope"];

  // Mutually exclusive — a single approval row encodes exactly one of
  // shell / filesystem / connector under `scope=` in `reason`. Match the
  // order of the parser so the discriminator is consistent across the
  // codebase.
  if (shellParsed) {
    title = approval.status === "pending" ? "Approve command" : `Command ${approval.status}`;
    shellScope = shellParsed;
  } else if (connectorParsed) {
    // Title reads as the action ("Phoebe wants to run slack.post_message"
    // in the §5.2 mockup), with the agent name + verb supplied by the
    // surrounding chat header. We just deliver the action half here.
    title =
      approval.status === "pending"
        ? `Run ${connectorParsed.serverDisplayName}.${connectorParsed.toolName}`
        : `${connectorParsed.serverDisplayName}.${connectorParsed.toolName} ${approval.status}`;
    connectorScope = connectorParsed;
  } else if (fsParsed) {
    title =
      approval.status === "pending"
        ? fsParsed.action === "read"
          ? "Approve read"
          : "Approve write"
        : `${fsParsed.action === "read" ? "Read" : "Write"} ${approval.status}`;
    filesystemScope = fsParsed;
  }

  return {
    id: approval.id,
    runId: approval.runId,
    threadId: approval.threadId,
    requestedByMemberId: approval.requestedBy,
    title,
    description,
    shellScope,
    filesystemScope,
    connectorScope,
    status: approval.status,
    requestedBy,
    createdAt: approval.createdAt,
    approvalsNeeded: 1,
  };
}
