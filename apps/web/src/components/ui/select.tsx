import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  id?: string;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

export function Select({ id, value, onChange, options, placeholder = "Select an option", className = "" }: SelectProps) {
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
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <span className={selectedOption ? "" : "text-zinc-400"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
              className={`flex w-full items-center justify-between px-4 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                option.disabled ? "cursor-not-allowed opacity-50" : ""
              } ${
                option.value === value
                  ? "bg-violet-50 font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                  : "text-zinc-700 dark:text-zinc-300"
              }`}
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
