"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { BootstrapResponse } from "@ujima/api-schema";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function SettingsPageHeader({ bootstrap }: { bootstrap: BootstrapResponse }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <WorkspaceSwitcher bootstrap={bootstrap} />
      <Link
        href="/workspace"
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-200/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to workspace
      </Link>
    </div>
  );
}
