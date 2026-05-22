"use client";

import type { ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-4 ${className}`.trim()}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? (
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
