"use client";

import { useId } from "react";

export function SegmentedRadio<T extends string>({
  ariaLabel,
  value,
  options,
  disabled = false,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const groupName = useId();
  return (
    <fieldset
      aria-label={ariaLabel}
      disabled={disabled}
      className="m-0 inline-flex overflow-hidden rounded-full border border-zinc-200 p-0 text-[11px] dark:border-zinc-800"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={`cursor-pointer px-2 py-0.5 transition focus-within:ring-2 focus-within:ring-zinc-400 ${
              selected
                ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}
