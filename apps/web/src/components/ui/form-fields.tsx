import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const INPUT_BASE_CLASS =
  "w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

const TEXTAREA_BASE_CLASS =
  "w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100" htmlFor={htmlFor}>
        {label}
      </label>
      {hint ? <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">{hint}</span> : null}
      <div className="mt-3">{children}</div>
      {error ? (
        <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  className = "",
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      {...props}
      className={`${INPUT_BASE_CLASS} ${error ? "border-red-300 focus:border-red-500 dark:border-red-500/60" : ""} ${className}`.trim()}
    />
  );
}

export function TextArea({
  className = "",
  error,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  return (
    <textarea
      {...props}
      className={`${TEXTAREA_BASE_CLASS} ${error ? "border-red-300 focus:border-red-500 dark:border-red-500/60" : ""} ${className}`.trim()}
    />
  );
}

export function ChannelScopeRow({ label }: { label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
      <input
        type="checkbox"
        checked
        disabled
        className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
      />
      <span className="text-zinc-700 dark:text-zinc-200">{label}</span>
    </label>
  );
}
