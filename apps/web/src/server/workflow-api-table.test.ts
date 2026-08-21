import { describe, expect, it } from "vitest";
import {
  daemonTargetUrl,
  isKnownWorkflowApiPath,
  matchWorkflowApiRoute,
} from "./workflow-api-table";

interface CallSiteFixture {
  method: string;
  /** Web URL segments after /api (as the dynamic [segment]/[[...rest]] params decode them). */
  segments: string[];
  /** Full web URL as the frontend builds it (see features/workflows/use-workflows.ts). */
  webUrl: string;
  /** Expected daemon target (path + query). */
  daemonTarget: string;
  fallbackMessage: string;
}

const FE_CALL_SITES: CallSiteFixture[] = [
  {
    method: "GET",
    segments: ["workflow-catalog"],
    webUrl: "https://ujima.test/api/workflow-catalog",
    daemonTarget: "/api/workflow-catalog",
    fallbackMessage: "Unable to load workflow catalog.",
  },
  {
    method: "GET",
    segments: ["workflows"],
    webUrl: "https://ujima.test/api/workflows",
    daemonTarget: "/api/workflows",
    fallbackMessage: "Unable to list workflows.",
  },
  {
    method: "GET",
    segments: ["workflows"],
    webUrl: "https://ujima.test/api/workflows?channelId=channel-general",
    daemonTarget: "/api/workflows?channelId=channel-general",
    fallbackMessage: "Unable to list workflows.",
  },
  {
    method: "POST",
    segments: ["workflows"],
    webUrl: "https://ujima.test/api/workflows",
    daemonTarget: "/api/workflows",
    fallbackMessage: "Unable to create workflow.",
  },
  {
    method: "GET",
    segments: ["workflows", "wf-001"],
    webUrl: "https://ujima.test/api/workflows/wf-001",
    daemonTarget: "/api/workflows/wf-001",
    fallbackMessage: "Unable to load workflow.",
  },
  {
    method: "PUT",
    segments: ["workflows", "wf-001"],
    webUrl: "https://ujima.test/api/workflows/wf-001",
    daemonTarget: "/api/workflows/wf-001",
    fallbackMessage: "Unable to save workflow.",
  },
  {
    method: "DELETE",
    segments: ["workflows", "wf-001"],
    webUrl: "https://ujima.test/api/workflows/wf-001",
    daemonTarget: "/api/workflows/wf-001",
    fallbackMessage: "Unable to delete workflow.",
  },
  {
    method: "POST",
    segments: ["workflows", "wf-001", "run"],
    webUrl: "https://ujima.test/api/workflows/wf-001/run",
    daemonTarget: "/api/workflows/wf-001/run",
    fallbackMessage: "Unable to start workflow.",
  },
  {
    method: "GET",
    segments: ["workflow-runs"],
    webUrl: "https://ujima.test/api/workflow-runs?status=completed",
    daemonTarget: "/api/workflow-runs?status=completed",
    fallbackMessage: "Unable to list workflow runs.",
  },
  {
    method: "GET",
    segments: ["workflow-runs", "run-42"],
    webUrl: "https://ujima.test/api/workflow-runs/run-42",
    daemonTarget: "/api/workflow-runs/run-42",
    fallbackMessage: "Unable to load workflow run.",
  },
  {
    method: "GET",
    segments: ["workflow-runs", "run-42", "artifact"],
    webUrl: "https://ujima.test/api/workflow-runs/run-42/artifact?path=summaries%2Ffinal.md",
    daemonTarget: "/api/workflow-runs/run-42/artifact?path=summaries%2Ffinal.md",
    fallbackMessage: "Unable to load artifact.",
  },
  {
    method: "POST",
    segments: ["workflow-runs", "run-42", "transition"],
    webUrl: "https://ujima.test/api/workflow-runs/run-42/transition",
    daemonTarget: "/api/workflow-runs/run-42/transition",
    fallbackMessage: "Unable to update workflow run.",
  },
  {
    method: "GET",
    segments: ["workflow-approvals"],
    webUrl: "https://ujima.test/api/workflow-approvals",
    daemonTarget: "/api/workflow-approvals",
    fallbackMessage: "Unable to load workflow approvals.",
  },
];

describe("workflow API routing table", () => {
  it.each(FE_CALL_SITES)(
    "maps $method $webUrl to the daemon ($daemonTarget)",
    ({ method, segments, webUrl, daemonTarget, fallbackMessage }) => {
      const match = matchWorkflowApiRoute(method, segments);
      expect(match).not.toBeNull();
      expect(match?.daemonPath).toBe(daemonTarget.split("?")[0]);
      expect(match?.fallbackMessage).toBe(fallbackMessage);
      expect(daemonTargetUrl(match!, webUrl)).toBe(daemonTarget);
    },
  );

  it("re-encodes percent-decoded id segments like the original forwarders", () => {
    const segments = ["workflow-runs", "my run/1"];
    const match = matchWorkflowApiRoute("GET", segments);
    expect(match?.daemonPath).toBe("/api/workflow-runs/my%20run%2F1");
    expect(daemonTargetUrl(match!, "https://example.test/api/workflow-runs/my%20run%2F1")).toBe(
      "/api/workflow-runs/my%20run%2F1",
    );
  });

  it("keeps the query string byte-identical when absent or present", () => {
    const list = matchWorkflowApiRoute("GET", ["workflow-runs"])!;
    expect(daemonTargetUrl(list, "https://example.test/api/workflow-runs")).toBe(
      "/api/workflow-runs",
    );
    expect(
      daemonTargetUrl(list, "https://example.test/api/workflow-runs?status=active%20now"),
    ).toBe("/api/workflow-runs?status=active%20now");
  });

  it("rejects unknown paths so non-workflow segments under /api still 404", () => {
    expect(matchWorkflowApiRoute("GET", ["nonsense"])).toBeNull();
    expect(matchWorkflowApiRoute("GET", ["settings", "team"])).toBeNull();
    expect(matchWorkflowApiRoute("GET", ["workflows", "x", "run", "extra"])).toBeNull();
    expect(isKnownWorkflowApiPath(["nonsense"])).toBe(false);
  });

  it("flags known paths with the wrong method so dispatch can 405", () => {
    expect(matchWorkflowApiRoute("POST", ["workflow-approvals"])).toBeNull();
    expect(isKnownWorkflowApiPath(["workflow-approvals"])).toBe(true);
    expect(matchWorkflowApiRoute("PATCH", ["workflows", "x"])).toBeNull();
    expect(isKnownWorkflowApiPath(["workflows", "x"])).toBe(true);
  });
});