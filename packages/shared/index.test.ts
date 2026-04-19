import { expect, test } from "bun:test";
import {
  ApprovalRequestSchema,
  AuditEventSchema,
  MessageSchema,
  SocketEventNames,
  SocketEventSchemas,
  resolveWorkspacePath,
} from "./index.ts";

test("resolveWorkspacePath keeps work inside the root", () => {
  expect(resolveWorkspacePath("/tmp/ujima-org", "apps/web")).toBe("/tmp/ujima-org/apps/web");
});

test("resolveWorkspacePath rejects traversal", () => {
  expect(() => resolveWorkspacePath("/tmp/ujima-org", "../secrets")).toThrow();
});

test("shared schemas parse core events", () => {
  const now = "2026-04-19T00:00:00.000Z";
  const message = MessageSchema.parse({
    id: "msg_1",
    organizationId: "org_1",
    threadId: "thread_1",
    senderId: "member_1",
    senderKind: "agent",
    content: "hello",
    createdAt: now,
  });

  expect(message.kind).toBe("human");
  expect(
    SocketEventSchemas[SocketEventNames.channelMessage].parse({
      organizationId: "org_1",
      channelId: "channel_1",
      message,
    }),
  ).toBeTruthy();

  expect(
    AuditEventSchema.parse({
      id: "audit_1",
      organizationId: "org_1",
      action: "tool.execute",
      targetType: "tool",
      createdAt: now,
    }).status,
  ).toBe("ok");

  expect(
    ApprovalRequestSchema.parse({
      id: "approval_1",
      organizationId: "org_1",
      requestedBy: "member_1",
      resourceType: "file",
      resourcePath: "/tmp/ujima-org/apps/api/index.js",
      action: "write",
      createdAt: now,
    }).status,
  ).toBe("pending");
});
