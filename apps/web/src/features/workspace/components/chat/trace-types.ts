export interface AggregatedOperation {
  id: string;
  type:
    | "edit"
    | "delete"
    | "read"
    | "search"
    | "shell"
    | "tool"
    | "skill"
    | "memory"
    | "goal"
    | "question"
    | "procedure"
    | "schedule"
    | "message"
    | "delegate";
  file?: string;
  additions: number;
  deletions: number;
  command?: string;
  query?: string;
  body?: string;
  status: "success" | "failed" | "running";
  toolName?: string;
  detail?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  lines?: string;
  skillRead?: {
    skillName: string;
    pluginName?: string;
    description?: string;
    output?: string;
  };
  terminal?: {
    cwd: string;
    commandLine: string;
    output?: string;
    outputPlaceholder?: string;
    outputTone?: "default" | "error";
  };
}

export interface TraceStepData {
  id: string;
  title: string;
  detail: string;
  reasoning?: string;
  time: string;
  duration: string;
  status: "success" | "running" | "failed";
  subtext?: string;
  actorId: string;
  actorName: string;
  runId?: string;
  /** First-class child-task id. When present, trace grouping uses this
   * instead of runId so delegation threads group by task boundary. */
  taskId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  aggregatedOperations?: AggregatedOperation[];
  terminal?: {
    cwd: string;
    commandLine: string;
    output?: string;
    outputPlaceholder?: string;
    outputTone?: "default" | "error";
    streamingJob?: {
      runId: string;
      jobId: string;
      organizationId: string;
    };
  };
  filesystem?: {
    action: "read" | "write";
    resourcePath: string;
    meta?: string;
    body?: string;
    bodyTone?: "default" | "error";
  };
  grep?: {
    query: string;
    path: string;
    count: number;
    limit: number;
    truncated?: boolean;
    matches: { path: string; lineNumber: number; line: string }[];
  };
  webSearch?: {
    query: string;
    site?: string;
    status: "streaming" | "completed";
    source: string;
    results: {
      title: string;
      url: string;
      snippet: string;
      source: string;
      rank: number;
    }[];
  };
  skillRead?: {
    skillName: string;
    pluginName?: string;
    description?: string;
    output?: string;
  };
}
