"use client";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
  menuPlacement?: "down" | "up";
  menuClassName?: string;
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
  menuPlacement = "down",
  menuClassName = "",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(
    null,
  );

  const selectedOption = options.find((opt) => opt.value === value);
  const portalTarget = typeof document === "undefined" ? null : document.body;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function updateMenuPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({
        top: menuPlacement === "up" ? rect.top : rect.bottom,
        left: rect.left,
        minWidth: rect.width,
        transform:
          menuPlacement === "up"
            ? "translateY(calc(-100% - 4px))"
            : "translateY(4px)",
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, menuPlacement]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
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

      {isOpen &&
        menuStyle &&
        portalTarget &&
        createPortal(
          <div
            ref={menuRef}
            className={`fixed z-[220] max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-950 ${
              menuClassName || ""
            }`}
            style={menuStyle}
          >
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
          </div>,
          portalTarget,
        )}
    </div>
  );
}
