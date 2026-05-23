"use client";

import { X, Terminal, TerminalSquare } from "lucide-react";
import { BackgroundShellJobPane } from "./background-shell-job-pane";

export interface ActiveJob {
  runId: string;
  jobId: string;
  commandLine: string;
  cwd: string;
  status: string;
}

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: ActiveJob[];
  organizationId: string;
}

export function TerminalDrawer({
  isOpen,
  onClose,
  jobs,
  organizationId,
}: TerminalDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      />

      {/* Drawer Container */}
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-lg transform bg-white shadow-2xl transition-all duration-300 animate-in slide-in-from-right dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800">
          <div className="flex h-full flex-col overflow-y-scroll py-6 px-5">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 pb-5 dark:border-zinc-900">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  <TerminalSquare className="h-5 w-5 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-zinc-950 dark:text-zinc-50">
                    Active Terminals
                  </h2>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    Manage and inspect background shell processes
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content List */}
            <div className="relative mt-6 flex-1 space-y-6">
              {jobs.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-50 text-zinc-400 dark:bg-zinc-900">
                    <Terminal className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 text-xs font-semibold text-zinc-950 dark:text-zinc-50">
                    No active terminals
                  </h3>
                  <p className="mt-1 max-w-xs text-[10px] text-zinc-400 leading-normal">
                    There are no running background shell processes at the moment.
                  </p>
                </div>
              ) : (
                <div className="space-y-6 pb-12">
                  {jobs.map((job) => (
                    <div
                      key={job.jobId}
                      className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-1 dark:border-zinc-800 dark:bg-zinc-900/30"
                    >
                      <BackgroundShellJobPane
                        cwd={job.cwd}
                        commandLine={job.commandLine}
                        runId={job.runId}
                        jobId={job.jobId}
                        organizationId={organizationId}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
