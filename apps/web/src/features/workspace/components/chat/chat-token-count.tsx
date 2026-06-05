"use client";

import { useEffect, useRef } from "react";

export function TokenCount({ value }: { value: number }) {
  const text = formatTokens(value);
  const previousText = usePrevious(text) ?? "";
  const chars = Array.from(text);

  return (
    <span className="inline-flex items-center gap-0.5 font-mono tabular-nums tracking-tight text-zinc-500">
      {chars.map((char, index) => {
        const previousChar = previousText[index];
        const changed = previousChar !== char;
        const animateClass = changed ? getTokenFlipAnimation(previousChar, char) : "";

        return (
          <span
            key={`${index}-${char}`}
            className={`inline-block [backface-visibility:hidden] ${animateClass}`}
            style={{
              transformStyle: "preserve-3d",
              animationFillMode: "both",
            }}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(n);
}

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

function getTokenFlipAnimation(previousChar: string | undefined, currentChar: string): string {
  if (isDigit(previousChar) && isDigit(currentChar)) {
    return Number(currentChar) >= Number(previousChar)
      ? "animate-token-flip-up"
      : "animate-token-flip-down";
  }
  return "animate-token-flip-up";
}

function isDigit(char: string | undefined): char is string {
  return typeof char === "string" && /^[0-9]$/.test(char);
}
