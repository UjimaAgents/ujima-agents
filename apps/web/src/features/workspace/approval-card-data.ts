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
  const { shell: shellParsed, filesystem: fsParsed } = parseApprovalDisplayScopesFromReason(approval.reason);
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

  if (shellParsed) {
    title = approval.status === "pending" ? "Approve command" : `Command ${approval.status}`;
    shellScope = shellParsed;
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
    status: approval.status,
    requestedBy,
    createdAt: approval.createdAt,
    approvalsNeeded: 1,
  };
}
