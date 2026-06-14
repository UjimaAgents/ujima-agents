"use client";

import { idleVoiceLevels, VOICE_INPUT_BAR_COUNT } from "./voice-input-support";

interface VoiceInputWavesProps {
  levels?: readonly number[];
  active?: boolean;
  className?: string;
  variant?: "default" | "on-primary";
}

const BAR_HEIGHT_PX = 14;

export function VoiceInputWaves({
  levels,
  active = true,
  className = "",
  variant = "default",
}: VoiceInputWavesProps) {
  const bars =
    levels && levels.length === VOICE_INPUT_BAR_COUNT ? levels : idleVoiceLevels();
  const barClass =
    variant === "on-primary"
      ? "bg-white"
      : active
        ? "bg-violet-500 dark:bg-violet-400"
        : "bg-zinc-300 transition-opacity duration-150 dark:bg-zinc-600";

  return (
    <div
      className={`flex h-7 w-7 items-center justify-center gap-[2px] ${className}`.trim()}
      aria-hidden
    >
      {bars.map((level, index) => {
        const scale = 0.22 + level * 0.92;
        const opacity = 0.5 + level * 0.5;
        return (
          <span
            key={index}
            className={`block w-[3px] rounded-full will-change-transform ${barClass}`}
            style={{
              height: `${BAR_HEIGHT_PX}px`,
              transform: `scaleY(${scale.toFixed(3)})`,
              transformOrigin: "center",
              opacity,
            }}
          />
        );
      })}
    </div>
  );
}
