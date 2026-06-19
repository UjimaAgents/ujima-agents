"use client";

import { useEffect, useId } from "react";

const previousTokenTextById = new Map<string, string>();

export function TokenCount({ value }: { value: number }) {
  return <AnimatedCharacters text={formatTokens(value)} className="font-mono tabular-nums tracking-tight text-zinc-500" />;
}

export function AnimatedCharacters({ text, className = "" }: { text: string; className?: string }) {
  const id = useId();
  const previousText = previousTokenTextById.get(id) ?? text;
  const chars = Array.from(text);

  useEffect(() => {
    previousTokenTextById.set(id, text);
    return () => {
      previousTokenTextById.delete(id);
    };
  }, [id, text]);

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
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
