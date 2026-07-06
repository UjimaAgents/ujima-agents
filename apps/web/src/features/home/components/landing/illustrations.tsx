"use client";

import React from "react";

export function CollaborativeMesh() {
  return (
    <div className="relative flex h-[260px] w-full items-center justify-center rounded-2xl border border-zinc-200/60 dark:border-zinc-800/50 bg-zinc-50/40 dark:bg-zinc-900/20 overflow-hidden select-none">

      {/* Subtle dot-grid background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(0,0,0,0.055)_1px,transparent_1px)] dark:bg-[radial-gradient(circle,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:20px_20px]" />

      <svg
        className="relative h-full w-full max-w-[520px]"
        viewBox="0 0 480 220"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ── Connection lines — muted, dashed ─────────────────────── */}
        <line x1="80"  y1="110" x2="240" y2="50"  stroke="currentColor" strokeWidth="1" strokeOpacity="0.12" strokeDasharray="5 4" />
        <line x1="80"  y1="110" x2="240" y2="170" stroke="currentColor" strokeWidth="1" strokeOpacity="0.12" strokeDasharray="5 4" />
        <line x1="240" y1="50"  x2="400" y2="110" stroke="currentColor" strokeWidth="1" strokeOpacity="0.12" strokeDasharray="5 4" />
        <line x1="240" y1="170" x2="400" y2="110" stroke="currentColor" strokeWidth="1" strokeOpacity="0.12" strokeDasharray="5 4" />
        <line x1="240" y1="50"  x2="240" y2="170" stroke="currentColor" strokeWidth="1" strokeOpacity="0.07" />

        {/* ── PM Node (Left) ────────────────────────────────────────── */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="6s" repeatCount="indefinite" />
          {/* Circle */}
          <circle cx="80" cy="110" r="24" className="fill-white dark:fill-zinc-900" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
          {/* Person icon */}
          <circle cx="80" cy="104" r="4.5" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" fill="none" />
          <path d="M71 118c0-3.5 4-6 9-6s9 2.5 9 6" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          {/* Label */}
          <text x="80" y="152" textAnchor="middle" fontSize="8.5" fontWeight="600" letterSpacing="0.06em" fill="currentColor" fillOpacity="0.35">
            PM
          </text>
        </g>

        {/* ── Dev Node (Top Center) ─────────────────────────────────── */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="4s" repeatCount="indefinite" />
          <circle cx="240" cy="50" r="24" className="fill-white dark:fill-zinc-900" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
          {/* Code icon */}
          <path d="M233 46l-4 4 4 4" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M247 46l4 4-4 4" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M242 43l-4 14"   stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <text x="240" y="90" textAnchor="middle" fontSize="8.5" fontWeight="600" letterSpacing="0.06em" fill="currentColor" fillOpacity="0.35">
            DEV
          </text>
        </g>

        {/* ── Test Node (Bottom Center) ─────────────────────────────── */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="5s" repeatCount="indefinite" />
          <circle cx="240" cy="170" r="24" className="fill-white dark:fill-zinc-900" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
          {/* Checkmark icon */}
          <path d="M231 170l5 5 10-10" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <text x="240" y="210" textAnchor="middle" fontSize="8.5" fontWeight="600" letterSpacing="0.06em" fill="currentColor" fillOpacity="0.35">
            QA
          </text>
        </g>

        {/* ── Reviewer Node (Right) ─────────────────────────────────── */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="4.5s" repeatCount="indefinite" />
          <circle cx="400" cy="110" r="24" className="fill-white dark:fill-zinc-900" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
          {/* Lines icon */}
          <path d="M390 106h20M390 110h20M392 114h14" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <text x="400" y="152" textAnchor="middle" fontSize="8.5" fontWeight="600" letterSpacing="0.06em" fill="currentColor" fillOpacity="0.35">
            REVIEWER
          </text>
        </g>
      </svg>
    </div>
  );
}

export function InteractiveSandboxCube() {
  return (
    <div className="relative flex h-[260px] w-full max-w-[340px] items-center justify-center rounded-2xl border border-zinc-200/60 dark:border-zinc-800/50 bg-zinc-50/40 dark:bg-zinc-900/20 overflow-hidden select-none">

      {/* Dot-grid */}
      <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(0,0,0,0.055)_1px,transparent_1px)] dark:bg-[radial-gradient(circle,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:20px_20px]" />

      <svg className="relative h-full w-full max-w-[200px]" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">

        {/* Isometric cube — all zinc strokes, barely-there fills */}
        <polygon points="100,160 150,130 100,100 50,130"
          fill="currentColor" fillOpacity="0.02"
          stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
        <polygon points="50,130 100,160 100,75 50,45"
          fill="currentColor" fillOpacity="0.02"
          stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
        <polygon points="100,160 150,130 150,45 100,75"
          fill="currentColor" fillOpacity="0.03"
          stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
        {/* Top face — dashed outline only */}
        <polygon points="100,75 150,45 100,15 50,45"
          fill="none"
          stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="3 3" />

        {/* File icon */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="6s" repeatCount="indefinite" />
          <rect x="70" y="80" width="18" height="22" rx="2"
            className="fill-white dark:fill-zinc-900"
            stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
          <line x1="75" y1="87" x2="83" y2="87" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.2" />
          <line x1="75" y1="91" x2="81" y2="91" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.2" />
          <line x1="75" y1="95" x2="83" y2="95" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
        </g>

        {/* Terminal icon */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="4s" repeatCount="indefinite" />
          <rect x="110" y="92" width="22" height="16" rx="2"
            className="fill-zinc-900 dark:fill-zinc-800"
            stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
          <path d="M114 97l3 3-3 3M119 103h4" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </g>

        {/* Lock icon */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="5s" repeatCount="indefinite" />
          <circle cx="100" cy="45" r="13"
            className="fill-white dark:fill-zinc-900"
            stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
          <rect x="94.5" y="44" width="11" height="8" rx="1.5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.4" fill="none" />
          <path d="M97 44v-2.5c0-1.7 1.3-3 3-3s3 1.3 3 3V44" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.4" fill="none" />
        </g>
      </svg>
    </div>
  );
}
