const API_PORT = process.env.UJIMA_PORT ?? "7511";
const WEB_PORT = process.env.WEB_PORT ?? "3452";

export function DaemonUnavailablePanel() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-[#09090b]">
      <div className="max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Ujima is not running
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          The web UI could not reach the API on port {API_PORT}. Start the local stack, then refresh
          this page.
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>
            If you installed from npm, run{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">ujima start</code> in a
            terminal.
          </li>
          <li>
            If you are developing the monorepo, run{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">bun run dev</code> from the
            repo root instead.
          </li>
          <li>
            Open the app at{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">
              http://127.0.0.1:{WEB_PORT}
            </code>{" "}
            (API defaults to port {API_PORT}).
          </li>
        </ol>
      </div>
    </main>
  );
}
