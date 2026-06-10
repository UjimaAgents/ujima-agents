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
  let attachmentRequestScope: ApprovalCardData["attachmentRequestScope"];

  // PR 11 — §17.5.6 attachment_request detection. The reason carries
  // `attachment_request_scope=<urlencoded JSON>` when the approval was
  // fired by request_attachment. Parsed BEFORE shell/connector/fs so
  // the variant takes priority; an attachment-request row can't carry
  // any other scope by construction.
  const attachmentRaw = parseApprovalReasonValue(
    approval.reason,
    "attachment_request_scope",
  );
  if (attachmentRaw) {
    try {
      const decoded = JSON.parse(attachmentRaw) as {
        serverId?: string;
        target?: "agent" | "channel";
        targetId?: string;
        agentReason?: string;
      };
      if (
        decoded.serverId &&
        (decoded.target === "agent" || decoded.target === "channel") &&
        decoded.targetId
      ) {
        const targetMember =
          decoded.target === "agent"
            ? state.members.find((m) => m.id === decoded.targetId)
            : undefined;
        attachmentRequestScope = {
          serverId: decoded.serverId,
          // The server display name comes from the registry/safeLabel
          // pipeline in the daemon; the frontend doesn't have the
          // McpServer object handy here, so fall back to the serverId
          // when no display name was passed. Operators can still see
          // the full id which is what gets sent to attachment-write.
          serverDisplayName: decoded.serverId,
          target: decoded.target,
          targetId: decoded.targetId,
          targetDisplayName:
            decoded.target === "channel"
              ? `#${decoded.targetId}`
              : (targetMember?.name ?? decoded.targetId),
          agentReason: decoded.agentReason ?? "",
        };
      }
    } catch {
      // Malformed payload — fall through to default rendering. The
      // approval row still resolves; the operator just won't see the
      // attachment-specific pane.
    }
  }

  // Mutually exclusive — a single approval row encodes exactly one of
  // shell / filesystem / connector / attachment_request under `scope=`
  // (or `attachment_request_scope=`) in `reason`. Match the order of
  // the parser so the discriminator is consistent across the codebase.
  if (attachmentRequestScope) {
    title =
      approval.status === "pending"
        ? `Attach ${attachmentRequestScope.serverDisplayName} to ${attachmentRequestScope.targetDisplayName}`
        : `Attach ${approval.status}`;
  } else if (shellParsed) {
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
    attachmentRequestScope,
    status: approval.status,
    requestedBy,
    createdAt: approval.createdAt,
    approvalsNeeded: 1,
  };
}
