"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Type } from "lucide-react";
import type { ChatFontSize } from "../../workspace-store";

const SIZE_OPTIONS: { value: ChatFontSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "X-Large" },
  { value: "xxlarge", label: "2X Large" },
  { value: "3xlarge", label: "3X Large" },
  { value: "6xlarge", label: "6X Large" },
];

export function FontSizeControl({
  value,
  onChange,
}: {
  value: ChatFontSize;
  onChange: (size: ChatFontSize) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const activeLabel = SIZE_OPTIONS.find((opt) => opt.value === value)?.label ?? "Normal";

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleSelect = useCallback(
    (size: ChatFontSize) => {
      onChange(size);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div className="font-size-controls relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
          value !== "normal"
            ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
            : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
        }`}
        aria-label="Font size"
        title={`Font size: ${activeLabel}`}
      >
        <Type className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{activeLabel}</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-50 mt-1 min-w-[130px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg shadow-black/5 dark:border-zinc-700 dark:bg-zinc-900 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={`flex w-full items-center px-3 py-1.5 text-[11px] font-semibold transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                value === option.value
                  ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                  : "text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {option.label}
              {value === option.value && (
                <span className="ml-auto text-[10px] text-violet-500">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
