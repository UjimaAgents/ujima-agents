"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Hash, Search, User } from "lucide-react";
import {
  listItemChevronIdle,
  listItemChevronSelected,
  listItemIconIdle,
  listItemIconSelected,
  listItemIdle,
  listItemSelected,
  listItemSubtitleIdle,
  listItemSubtitleSelected,
} from "@/lib/list-item-styles";

export interface SearchResult {
  id: string;
  type: "channel" | "agent";
  label: string;
  subtitle?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  results: SearchResult[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const typeIcon: Record<SearchResult["type"], typeof Hash> = {
  channel: Hash,
  agent: User,
};

export function CommandPalette({ results, open, onOpenChange }: CommandPaletteProps) {
  if (!open) return null;
  return <CommandPalettePanel results={results} onOpenChange={onOpenChange} />;
}

function CommandPalettePanel({
  results,
  onOpenChange,
}: Omit<CommandPaletteProps, "open">) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return results;
    const q = query.toLowerCase();
    return results.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        (r.subtitle && r.subtitle.toLowerCase().includes(q)),
    );
  }, [results, query]);

  const activeIndex =
    filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && filtered[activeIndex]) {
        e.preventDefault();
        filtered[activeIndex].onSelect();
        onOpenChange(false);
      }
    },
    [activeIndex, filtered, onOpenChange],
  );

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-start justify-center pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 dark:border-zinc-800">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search channels and agents..."
            className="h-12 w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
        </div>
        <div ref={listRef} className="max-h-72 overflow-y-auto px-1.5 py-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Search className="h-5 w-5 text-zinc-300 dark:text-zinc-600" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {query.trim() ? "No results found." : "Start typing to search."}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((result, index) => {
                const Icon = typeIcon[result.type];
                const selected = index === activeIndex;
                return (
                  <button
                    key={result.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => {
                      result.onSelect();
                      onOpenChange(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                      selected ? listItemSelected : listItemIdle
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${selected ? listItemIconSelected : listItemIconIdle}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{result.label}</p>
                      {result.subtitle && (
                        <p
                          className={`truncate text-xs ${
                            selected ? listItemSubtitleSelected : listItemSubtitleIdle
                          }`}
                        >
                          {result.subtitle}
                        </p>
                      )}
                    </div>
                    <ArrowRight
                      className={`h-3.5 w-3.5 shrink-0 ${
                        selected ? listItemChevronSelected : listItemChevronIdle
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
