/**
 * Routing table for the workflow API group.
 *
 * These routes used to exist as nine one-file forwarders under
 * apps/web/src/app/api (workflow-approvals, workflow-catalog, workflow-runs,
 * workflows), each repeating "proxy this path to the daemon". This module is
 * the single source of truth: (method, url segments) -> daemon target.
 *
 * The App Router entry point is the dynamic route
 * apps/web/src/app/api/[segment]/[[...rest]]/route.ts. Next.js resolves static
 * segments before dynamic ones, so the ~22 static API segments (approvals,
 * auth, settings, ...) still match their own routes and only the workflow*
 * paths below reach the dynamic route. Paths not listed here are rejected.
 */

export type WorkflowApiMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface WorkflowApiRouteSpec {
  method: WorkflowApiMethod;
  /** URL pattern as segments; a `{name}` token captures any single segment. */
  pattern: readonly string[];
  /** Daemon path template; `{name}` tokens are percent-encoded when matched. */
  daemonPath: string;
  fallbackMessage: string;
}

export interface WorkflowApiMatch {
  method: WorkflowApiMethod;
  /** Fully expanded daemon path, without the query string. */
  daemonPath: string;
  fallbackMessage: string;
}

export const WORKFLOW_API_ROUTES: readonly WorkflowApiRouteSpec[] = [
  {
    method: "GET",
    pattern: ["workflow-approvals"],
    daemonPath: "/api/workflow-approvals",
    fallbackMessage: "Unable to load workflow approvals.",
  },
  {
    method: "GET",
    pattern: ["workflow-catalog"],
    daemonPath: "/api/workflow-catalog",
    fallbackMessage: "Unable to load workflow catalog.",
  },
  {
    method: "GET",
    pattern: ["workflow-runs"],
    daemonPath: "/api/workflow-runs",
    fallbackMessage: "Unable to list workflow runs.",
  },
  {
    method: "GET",
    pattern: ["workflow-runs", "{id}"],
    daemonPath: "/api/workflow-runs/{id}",
    fallbackMessage: "Unable to load workflow run.",
  },
  {
    method: "POST",
    pattern: ["workflow-runs", "{id}", "transition"],
    daemonPath: "/api/workflow-runs/{id}/transition",
    fallbackMessage: "Unable to update workflow run.",
  },
  {
    method: "GET",
    pattern: ["workflow-runs", "{id}", "artifact"],
    daemonPath: "/api/workflow-runs/{id}/artifact",
    fallbackMessage: "Unable to load artifact.",
  },
  {
    method: "GET",
    pattern: ["workflows"],
    daemonPath: "/api/workflows",
    fallbackMessage: "Unable to list workflows.",
  },
  {
    method: "POST",
    pattern: ["workflows"],
    daemonPath: "/api/workflows",
    fallbackMessage: "Unable to create workflow.",
  },
  {
    method: "GET",
    pattern: ["workflows", "{id}"],
    daemonPath: "/api/workflows/{id}",
    fallbackMessage: "Unable to load workflow.",
  },
  {
    method: "PUT",
    pattern: ["workflows", "{id}"],
    daemonPath: "/api/workflows/{id}",
    fallbackMessage: "Unable to save workflow.",
  },
  {
    method: "DELETE",
    pattern: ["workflows", "{id}"],
    daemonPath: "/api/workflows/{id}",
    fallbackMessage: "Unable to delete workflow.",
  },
  {
    method: "POST",
    pattern: ["workflows", "{id}", "run"],
    daemonPath: "/api/workflows/{id}/run",
    fallbackMessage: "Unable to start workflow.",
  },
];

function captureParams(
  pattern: readonly string[],
  segments: readonly string[],
): Record<string, string> | null {
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index++) {
    const token = pattern[index];
    if (token.startsWith("{") && token.endsWith("}")) {
      params[token.slice(1, -1)] = segments[index];
    } else if (token !== segments[index]) {
      return null;
    }
  }
  return params;
}

function expandDaemonPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (token, name) => encodeURIComponent(params[name]));
}

/** Resolve a (method, segments) pair to a daemon target, or null when absent. */
export function matchWorkflowApiRoute(
  method: string,
  segments: readonly string[],
): WorkflowApiMatch | null {
  for (const spec of WORKFLOW_API_ROUTES) {
    if (spec.method !== method) continue;
    const params = captureParams(spec.pattern, segments);
    if (params) {
      return {
        method: spec.method,
        daemonPath: expandDaemonPath(spec.daemonPath, params),
        fallbackMessage: spec.fallbackMessage,
      };
    }
  }
  return null;
}

/** True when any route matches these segments regardless of method (405 vs 404). */
export function isKnownWorkflowApiPath(segments: readonly string[]): boolean {
  return WORKFLOW_API_ROUTES.some((spec) => captureParams(spec.pattern, segments) !== null);
}

/**
 * Full daemon URL for a match: the expanded path plus the incoming request's
 * query string, unmodified, so client-supplied query params round-trip
 * byte-identical (workflow-runs?status=, workflows?channelId=,
 * workflow-runs/{id}/artifact?path=).
 */
export function daemonTargetUrl(match: WorkflowApiMatch, requestUrl: string): string {
  const search = new URL(requestUrl).search;
  return search ? `${match.daemonPath}${search}` : match.daemonPath;
}