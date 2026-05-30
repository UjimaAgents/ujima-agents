"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { listItemIdle, listItemSelected } from "@/lib/list-item-styles";

export interface SelectOption {
  value: string;
  /** Shown in the dropdown list */
  label: string;
  /** Shown on the closed trigger when selected; defaults to `label` */
  selectedLabel?: string;
  disabled?: boolean;
}

export interface SelectProps {
  id?: string;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: "default" | "sm";
  disabled?: boolean;
  ariaLabel?: string;
}

const triggerSizeClass = {
  default: "px-4 py-2.5 text-sm",
  sm: "px-2.5 py-1.5 text-xs",
} as const;

export function Select({
  id,
  value,
  onChange,
  options,
  placeholder = "Select an option",
  className = "",
  size = "default",
  disabled = false,
  ariaLabel,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white text-zinc-900 outline-none transition focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 ${triggerSizeClass[size]}`}
      >
        <span className={`min-w-0 truncate ${selectedOption ? "" : "text-zinc-400"}`}>
          {selectedOption ? (selectedOption.selectedLabel ?? selectedOption.label) : placeholder}
        </span>
        <ChevronDown
          className={`shrink-0 text-zinc-400 transition-transform ${size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => {
                onChange({ target: { value: option.value } });
                setIsOpen(false);
              }}
              className={`flex w-full items-center justify-between px-4 py-2 text-left font-medium transition ${
                option.disabled ? "cursor-not-allowed opacity-50" : ""
              } ${option.value === value ? listItemSelected : listItemIdle}`}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && <Check className="ml-2 h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
