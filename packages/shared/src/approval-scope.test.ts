import {describe, expect, it} from "vitest";
import {
  approvalPersistedGrantMatches,
  approvalScopeMatches,
  approvalScopeMatchesPersisted,
  buildConnectorScope,
  canonicalizeApprovalFamilyScope,
  canonicalizeApprovalGrantScope,
  enrichApprovalScopeForDisplay,
  enrichEditScopeFields,
  formatPersistedApprovalGrantReason,
  formatApprovalRelayMarkdown,
  parseApprovalDisplayScopesFromReason,
  parseConnectorScope,
  parseFilesystemScope,
  shellInvocationDisplayLine,
} from "./approval-scope";

describe("enrichEditScopeFields", () => {
  it("computes startLine from file content", () => {
    const fileContent = "line1\nline2\nold\nline4";
    expect(
      enrichEditScopeFields({
        oldString: "old",
        newString: "new",
        fileContent,
      })
    ).toEqual({
      oldString: "old",
      newString: "new",
      replaceAll: false,
      startLine: 3,
    });
  });

  it("enriches edit scope for approval display", () => {
    const base =
      'edit:{"resourcePath":"/x/a.md","oldString":"old","newString":"new"}';
    const fileContent = "before\nold\nafter";
    expect(enrichApprovalScopeForDisplay(base, fileContent)).toBe(
      'edit:{"resourcePath":"/x/a.md","oldString":"old","newString":"new","replaceAll":false,"startLine":2}'
    );
  });
});

describe("formatApprovalRelayMarkdown", () => {
  it("renders cwd and shell line for shell scope", () => {
    const scope = 'shell:{"cwd":"/workspace","command":"git","args":["diff"]}';
    expect(
      formatApprovalRelayMarkdown({
        action: "execute",
        resourcePath: "/workspace",
        reason: `Tool action requires approval;scope=${encodeURIComponent(scope)}`,
      })
    ).toBe("[Approval needed] Shell\nCwd: /workspace\nCommand: git diff");
  });

  it("renders workspace write approval as a diff patch", () => {
    const scope = JSON.stringify({
      resourcePath: "/x/a.md",
      content: "hello\nworld",
    });
    expect(
      formatApprovalRelayMarkdown({
        action: "write",
        resourcePath: "/x/a.md",
        reason: `Tool action requires approval;scope=${encodeURIComponent("write:" + scope)}`,
      })
    ).toBe(
      "[Approval needed] Filesystem write\nPath: /x/a.md\nPatch:\n--- /x/a.md\n+++ /x/a.md\n@@ -0,0 +1,2 @@\n+hello\n+world"
    );
  });
});

describe("parseApprovalDisplayScopesFromReason", () => {
  it("returns shell only for shell scope", () => {
    const scope = 'shell:{"cwd":"/w","command":"ls"}';
    const reason = `Tool action requires approval;scope=${encodeURIComponent(scope)}`;
    expect(parseApprovalDisplayScopesFromReason(reason)).toEqual({
      shell: {cwd: "/w", command: "ls"},
      filesystem: null,
      connector: null,
    });
  });

  it("returns connector only for a connector scope built via buildConnectorScope", () => {
    const scope = buildConnectorScope({
      serverId: "slack",
      serverDisplayName: "Slack",
      toolName: "post_message",
      argsPreview: 'channel: "#team"\ntext:    "Migration PR opened"',
    });
    const reason = `Tool action requires approval;scope=${encodeURIComponent(scope)}`;
    expect(parseApprovalDisplayScopesFromReason(reason)).toEqual({
      shell: null,
      filesystem: null,
      connector: {
        serverId: "slack",
        serverDisplayName: "Slack",
        toolName: "post_message",
        argsPreview: 'channel: "#team"\ntext:    "Migration PR opened"',
      },
    });
  });
});

describe("parseConnectorScope / buildConnectorScope", () => {
  it("round-trips a connector scope", () => {
    const original = {
      serverId: "slack",
      serverDisplayName: "Slack",
      toolName: "post_message",
      argsPreview: 'channel: "#team"',
    };
    const built = buildConnectorScope(original);
    expect(built.startsWith("connector:")).toBe(true);
    expect(parseConnectorScope(built)).toEqual(original);
  });
});

describe("parseFilesystemScope", () => {
  it("parses compact read scope", () => {
    expect(parseFilesystemScope("filesystem:read:/tmp/a.txt")).toEqual({
      action: "read",
      resourcePath: "/tmp/a.txt",
    });
  });
});

describe("shellInvocationDisplayLine", () => {
  it("joins command and args", () => {
    expect(
      shellInvocationDisplayLine({
        cwd: "/tmp",
        command: "sh",
        args: ["-c", "echo hi"],
      })
    ).toBe("sh -c echo hi");
  });
});

describe("approvalPersistedGrantMatches", () => {
  it("matches later shell invocations under an allow_family grant", () => {
    const familyScope = 'shell:{"cwd":"/workspace","command":"git"}';
    const grantReason = formatPersistedApprovalGrantReason(
      "family",
      familyScope,
      "git family"
    );
    const diff = 'shell:{"cwd":"/workspace","command":"git","args":["diff"]}';
    const status =
      'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    expect(approvalPersistedGrantMatches(grantReason, familyScope, diff)).toBe(
      true
    );
    expect(
      approvalPersistedGrantMatches(grantReason, familyScope, status)
    ).toBe(true);
  });

  it("does not treat allow_always grants as family-wide shell access", () => {
    const exactScope =
      'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    const grantReason = formatPersistedApprovalGrantReason(
      "grant",
      exactScope,
      "exact"
    );
    const log = 'shell:{"cwd":"/workspace","command":"git","args":["log"]}';
    expect(
      approvalPersistedGrantMatches(grantReason, exactScope, exactScope)
    ).toBe(true);
    expect(approvalPersistedGrantMatches(grantReason, exactScope, log)).toBe(
      false
    );
  });
});

describe("approvalScopeMatches", () => {
  it("matches legacy shell scopes to canonical JSON at grant precision", () => {
    const legacy = 'shell:/workspace:git:["status"]';
    const status =
      'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    const log = 'shell:{"cwd":"/workspace","command":"git","args":["log"]}';
    expect(approvalScopeMatches(legacy, status)).toBe(true);
    expect(approvalScopeMatches(legacy, log)).toBe(false);
  });

  it("does not treat different shell args as family-equivalent in grant mode", () => {
    const status =
      'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    const log = 'shell:{"cwd":"/workspace","command":"git","args":["log"]}';
    expect(canonicalizeApprovalFamilyScope(status)).toBe(
      canonicalizeApprovalFamilyScope(log)
    );
    expect(approvalScopeMatches(status, log)).toBe(false);
    expect(
      approvalScopeMatchesPersisted(
        status,
        canonicalizeApprovalFamilyScope(log),
        "family"
      )
    ).toBe(true);
    expect(
      approvalScopeMatchesPersisted(
        status,
        canonicalizeApprovalGrantScope(log),
        "grant"
      )
    ).toBe(false);
  });

  it("uses the connector argument fingerprint instead of display preview", () => {
    const first = buildConnectorScope({
      serverId: "slack",
      serverDisplayName: "Slack",
      toolName: "post_message",
      argsPreview: 'text: "hello"',
      argsFingerprint: "same-call",
    });
    const sameCall = buildConnectorScope({
      serverId: "slack",
      serverDisplayName: "Slack",
      toolName: "post_message",
      argsPreview: 'text: [redacted]',
      argsFingerprint: "same-call",
    });
    const differentCall = buildConnectorScope({
      serverId: "slack",
      serverDisplayName: "Slack",
      toolName: "post_message",
      argsPreview: 'text: "hello"',
      argsFingerprint: "different-call",
    });
    expect(approvalScopeMatches(first, sameCall)).toBe(true);
    expect(approvalScopeMatches(first, differentCall)).toBe(false);
  });
});
