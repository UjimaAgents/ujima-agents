import { WebSearchToolPane } from "../../workspace/components/chat/web-search-tool-pane";

interface ToolCallPanelProps {
  tools: { name: string; status: "idle" | "running" | "done" }[];
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
}

const STATUS_CLASS: Record<ToolCallPanelProps["tools"][number]["status"], string> = {
  idle: "bg-zinc-200 text-zinc-700",
  running: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
};

export function ToolCallPanel({ tools, webSearch }: ToolCallPanelProps) {
  return (
    <section className="h-full rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tool Call UI</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Generative UI (RSC)</span>
      </div>
      <div className="space-y-2">
        {tools.map((tool) => (
          <div key={tool.name} className="flex items-center justify-between rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <span className="text-sm text-zinc-800 dark:text-zinc-200">{tool.name}</span>
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_CLASS[tool.status]}`}>
              {tool.status}
            </span>
          </div>
        ))}
      </div>
      {webSearch ? (
        <div className="mt-3">
          <WebSearchToolPane
            query={webSearch.query}
            site={webSearch.site}
            status={webSearch.status}
            source={webSearch.source}
            results={webSearch.results}
          />
        </div>
      ) : null}
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        This panel is designed as a slot to progressively replace static rows with server-driven generative components.
      </p>
    </section>
  );
}
