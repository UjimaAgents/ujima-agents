"use client";

import React, { useState, useEffect, useRef } from "react";
import { LandingSection, LandingContainer } from "./primitives";

/* ─── Data ─────────────────────────────────────────────────────────────── */

interface Agent {
  name: string;
  role: string;
  status: "active" | "preview" | "soon";
}

interface Industry {
  id: string;
  name: string;
  hex: string;
  tagline: string;
  agents: Agent[];
}

const INDUSTRIES: Industry[] = [
  {
    id: "engineering",
    name: "Engineering",
    hex: "#3b82f6",
    tagline: "Build, test & ship — autonomously.",
    agents: [
      { name: "Frontend Engineer",   role: "frontendEngineer", status: "active"  },
      { name: "Backend Engineer",    role: "backendEngineer",  status: "active"  },
      { name: "QA Engineer",         role: "qaEngineer",       status: "active"  },
      { name: "DevOps Specialist",   role: "devopsEngineer",   status: "preview" },
    ],
  },
  {
    id: "product",
    name: "Product",
    hex: "#8b5cf6",
    tagline: "Plan, prioritise & ship on schedule.",
    agents: [
      { name: "Product Manager",     role: "pm",               status: "active"  },
      { name: "User Researcher",     role: "userResearcher",   status: "preview" },
      { name: "Technical Writer",    role: "technicalWriter",  status: "active"  },
    ],
  },
  {
    id: "marketing",
    name: "Marketing",
    hex: "#10b981",
    tagline: "Rank, convert & grow your audience.",
    agents: [
      { name: "Search Optimizer",    role: "seoSpecialist",    status: "active"  },
      { name: "Content Creator",     role: "contentCreator",   status: "active"  },
      { name: "Growth Specialist",   role: "growthHacker",     status: "preview" },
    ],
  },
  {
    id: "design",
    name: "Design",
    hex: "#ec4899",
    tagline: "Ship polished visuals & design systems.",
    agents: [
      { name: "UI/UX Designer",      role: "designer",         status: "active"  },
      { name: "Motion Artist",       role: "motionDesigner",   status: "preview" },
    ],
  },
  {
    id: "paid-media",
    name: "Paid Media",
    hex: "#f59e0b",
    tagline: "Maximise returns across every channel.",
    agents: [
      { name: "Campaign Manager",    role: "adManager",        status: "active"  },
      { name: "Performance Analyst", role: "adAnalyst",        status: "preview" },
    ],
  },
];

/* ─── Illustrations ──────────────────────────────────────────────────────
   All muted — currentColor + low opacity only, no hardcoded colors.
────────────────────────────────────────────────────────────────────────── */

/** Engineering: agent mesh network */
function IllustrationEngineering() {
  return (
    <svg viewBox="0 0 480 200" fill="none" className="h-full w-full max-w-[520px]">
      {/* Lines */}
      <line x1="90"  y1="100" x2="240" y2="40"  stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="5 4"/>
      <line x1="90"  y1="100" x2="240" y2="160" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="5 4"/>
      <line x1="240" y1="40"  x2="390" y2="100" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="5 4"/>
      <line x1="240" y1="160" x2="390" y2="100" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="5 4"/>
      <line x1="240" y1="40"  x2="240" y2="160" stroke="currentColor" strokeOpacity="0.07" strokeWidth="1"/>
      {/* PM node */}
      <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="6s" repeatCount="indefinite"/>
        <circle cx="90" cy="100" r="22" className="fill-white dark:fill-zinc-900" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5"/>
        <circle cx="90" cy="94" r="4.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" fill="none"/>
        <path d="M81 110c0-3.5 4-6 9-6s9 2.5 9 6" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
        <text x="90" y="140" textAnchor="middle" fontSize="8" fontWeight="600" letterSpacing="0.07em" fill="currentColor" fillOpacity="0.3">PM</text>
      </g>
      {/* Dev node */}
      <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="4s" repeatCount="indefinite"/>
        <circle cx="240" cy="40" r="22" className="fill-white dark:fill-zinc-900" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5"/>
        <path d="M233 36l-4 4 4 4" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <path d="M247 36l4 4-4 4" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <path d="M243 33l-4 14"   stroke="currentColor" strokeOpacity="0.3"  strokeWidth="1.4" strokeLinecap="round" fill="none"/>
        <text x="240" y="80" textAnchor="middle" fontSize="8" fontWeight="600" letterSpacing="0.07em" fill="currentColor" fillOpacity="0.3">DEV</text>
      </g>
      {/* QA node */}
      <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="5s" repeatCount="indefinite"/>
        <circle cx="240" cy="160" r="22" className="fill-white dark:fill-zinc-900" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5"/>
        <path d="M231 160l5 5 10-10" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <text x="240" y="200" textAnchor="middle" fontSize="8" fontWeight="600" letterSpacing="0.07em" fill="currentColor" fillOpacity="0.3">QA</text>
      </g>
      {/* Reviewer node */}
      <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="4.5s" repeatCount="indefinite"/>
        <circle cx="390" cy="100" r="22" className="fill-white dark:fill-zinc-900" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5"/>
        <path d="M380 96h20M380 100h20M382 104h14" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
        <text x="390" y="140" textAnchor="middle" fontSize="8" fontWeight="600" letterSpacing="0.07em" fill="currentColor" fillOpacity="0.3">REVIEWER</text>
      </g>
    </svg>
  );
}

/** Product: kanban board */
function IllustrationProduct() {
  const cols = [
    { label: "BACKLOG", cards: [28, 20, 24] },
    { label: "IN PROGRESS", cards: [32, 18] },
    { label: "DONE", cards: [22, 26, 20] },
  ];
  const colW = 110, gap = 20, startX = 75;
  return (
    <svg viewBox="0 0 480 200" fill="none" className="h-full w-full max-w-[520px]">
      {cols.map((col, ci) => {
        const x = startX + ci * (colW + gap);
        let y = 44;
        return (
          <g key={col.label}>
            {/* Column header */}
            <rect x={x} y={20} width={colW} height={16} rx="4"
              className="fill-zinc-100 dark:fill-zinc-800" fillOpacity="0.6"/>
            <text x={x + colW / 2} y={31} textAnchor="middle" fontSize="7.5" fontWeight="700"
              letterSpacing="0.08em" fill="currentColor" fillOpacity="0.35">{col.label}</text>
            {/* Cards */}
            {col.cards.map((w, ri) => {
              const cardY = y;
              y += 26;
              return (
                <g key={ri}>
                  <animateTransform attributeName="transform" type="translate"
                    values="0 0;0 -2;0 0" dur={`${4 + ri * 1.2}s`} repeatCount="indefinite"/>
                  <rect x={x + 4} y={cardY} width={colW - 8} height={20} rx="4"
                    className="fill-white dark:fill-zinc-900"
                    stroke="currentColor" strokeOpacity="0.12" strokeWidth="1"/>
                  <rect x={x + 10} y={cardY + 7} width={w} height="6" rx="2"
                    fill="currentColor" fillOpacity="0.1"/>
                  <circle cx={x + colW - 12} cy={cardY + 10} r="4"
                    stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" fill="none"/>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** Marketing: funnel */
function IllustrationMarketing() {
  const stages = [
    { label: "DISCOVER", y: 30, w: 280, h: 44 },
    { label: "CONVERT",  y: 84, w: 200, h: 44 },
    { label: "RETAIN",   y: 138, w: 130, h: 44 },
  ];
  return (
    <svg viewBox="0 0 480 200" fill="none" className="h-full w-full max-w-[520px]">
      {stages.map((s, i) => (
        <g key={s.label}>
          <animateTransform attributeName="transform" type="translate"
            values="0 0;0 -2;0 0" dur={`${5 + i}s`} repeatCount="indefinite"/>
          <rect x={(480 - s.w) / 2} y={s.y} width={s.w} height={s.h} rx="10"
            className="fill-white dark:fill-zinc-900"
            stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5"/>
          <text x="240" y={s.y + s.h / 2 + 4} textAnchor="middle" fontSize="9"
            fontWeight="700" letterSpacing="0.09em" fill="currentColor" fillOpacity="0.3">
            {s.label}
          </text>
          {/* dot count hints */}
          {Array.from({ length: 3 - i }).map((_, d) => (
            <circle key={d} cx={(480 - s.w) / 2 + 16 + d * 14} cy={s.y + s.h / 2}
              r="3" fill="currentColor" fillOpacity="0.12"/>
          ))}
        </g>
      ))}
      {/* Connecting lines between stages */}
      <line x1="240" y1="74"  x2="240" y2="84"  stroke="currentColor" strokeOpacity="0.1" strokeWidth="1"/>
      <line x1="240" y1="128" x2="240" y2="138" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1"/>
    </svg>
  );
}

/** Design: UI canvas wireframe */
function IllustrationDesign() {
  return (
    <svg viewBox="0 0 480 200" fill="none" className="h-full w-full max-w-[520px]">
      {/* Canvas frame */}
      <rect x="60" y="20" width="360" height="160" rx="10"
        className="fill-white dark:fill-zinc-900"
        stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5"/>
      {/* Nav bar */}
      <rect x="60" y="20" width="360" height="28" rx="10"
        fill="currentColor" fillOpacity="0.04"
        stroke="currentColor" strokeOpacity="0.1" strokeWidth="1"/>
      <circle cx="80"  cy="34" r="4" fill="currentColor" fillOpacity="0.12"/>
      <circle cx="96"  cy="34" r="4" fill="currentColor" fillOpacity="0.08"/>
      <circle cx="112" cy="34" r="4" fill="currentColor" fillOpacity="0.06"/>
      <rect x="300" y="28" width="60" height="12" rx="4" fill="currentColor" fillOpacity="0.08"/>
      {/* Hero block */}
      <rect x="80" y="62" width="200" height="14" rx="3" fill="currentColor" fillOpacity="0.12"/>
      <rect x="80" y="82" width="150" height="8"  rx="3" fill="currentColor" fillOpacity="0.07"/>
      <rect x="80" y="96" width="120" height="8"  rx="3" fill="currentColor" fillOpacity="0.07"/>
      {/* CTA button */}
      <rect x="80" y="114" width="70" height="20" rx="6"
        stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.2" fill="currentColor" fillOpacity="0.06"/>
      <rect x="160" y="114" width="55" height="20" rx="6"
        stroke="currentColor" strokeOpacity="0.1" strokeWidth="1.2" fill="none"/>
      {/* Right image placeholder */}
      <rect x="300" y="58" width="100" height="84" rx="6"
        fill="currentColor" fillOpacity="0.05"
        stroke="currentColor" strokeOpacity="0.1" strokeWidth="1"/>
      <path d="M316 116l16-20 12 14 8-8 20 18" stroke="currentColor" strokeOpacity="0.15"
        strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Floating design token chip */}
      <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="5s" repeatCount="indefinite"/>
        <rect x="370" y="28" width="34" height="14" rx="4"
          className="fill-white dark:fill-zinc-800"
          stroke="currentColor" strokeOpacity="0.2" strokeWidth="1"/>
        <text x="387" y="38" textAnchor="middle" fontSize="6.5" fontWeight="700"
          letterSpacing="0.05em" fill="currentColor" fillOpacity="0.4">Aa</text>
      </g>
    </svg>
  );
}

/** Paid Media: performance chart */
function IllustrationPaidMedia() {
  const points = "80,160 140,130 200,140 260,100 320,90 380,60 420,50";
  return (
    <svg viewBox="0 0 480 200" fill="none" className="h-full w-full max-w-[520px]">
      {/* Grid lines */}
      {[40, 80, 120, 160].map(y => (
        <line key={y} x1="70" y1={y} x2="440" y2={y}
          stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="4 4"/>
      ))}
      {/* Area fill */}
      <polyline points={points} stroke="currentColor" strokeOpacity="0" fill="none"/>
      <polygon points={`${points} 420,180 80,180`}
        fill="currentColor" fillOpacity="0.04"/>
      {/* Line */}
      <polyline points={points}
        stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Data points */}
      {points.split(" ").map((pt, i) => {
        const [cx, cy] = pt.split(",").map(Number);
        return (
          <g key={i}>
            <animateTransform attributeName="transform" type="translate"
              values="0 0;0 -2;0 0" dur={`${3 + i * 0.4}s`} repeatCount="indefinite"/>
            <circle cx={cx} cy={cy} r="4"
              className="fill-white dark:fill-zinc-900"
              stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5"/>
          </g>
        );
      })}
      {/* Metric badges */}
      <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="5s" repeatCount="indefinite"/>
        <rect x="333" y="60" width="74" height="22" rx="6"
          className="fill-white dark:fill-zinc-900"
          stroke="currentColor" strokeOpacity="0.15" strokeWidth="1"/>
        <text x="370" y="74" textAnchor="middle" fontSize="8" fontWeight="700"
          letterSpacing="0.05em" fill="currentColor" fillOpacity="0.4">REVENUE ↑</text>
      </g>
      <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="6s" repeatCount="indefinite"/>
        <rect x="128" y="100" width="58" height="22" rx="6"
          className="fill-white dark:fill-zinc-900"
          stroke="currentColor" strokeOpacity="0.15" strokeWidth="1"/>
        <text x="157" y="114" textAnchor="middle" fontSize="8" fontWeight="700"
          letterSpacing="0.05em" fill="currentColor" fillOpacity="0.4">COST ↓</text>
      </g>
    </svg>
  );
}

const ILLUSTRATIONS = [
  IllustrationEngineering,
  IllustrationProduct,
  IllustrationMarketing,
  IllustrationDesign,
  IllustrationPaidMedia,
];

/* ─── Avatar ─────────────────────────────────────────────────────────────── */

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 tracking-wide">
      {initials}
    </span>
  );
}

/* ─── Component ─────────────────────────────────────────────────────────── */

const AUTO_INTERVAL = 3500;

export function IndustryCarousel() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = INDUSTRIES[activeIdx];
  const Illustration = ILLUSTRATIONS[activeIdx];

  // Select a tab manually — restart timer
  function selectTab(idx: number) {
    setActiveIdx(idx);
    setAnimKey((k) => k + 1);
    // restart auto-advance
    if (timerRef.current) clearInterval(timerRef.current);
    if (!paused) startTimer();
  }

  function startTimer() {
    timerRef.current = setInterval(() => {
      setActiveIdx((prev) => {
        const next = (prev + 1) % INDUSTRIES.length;
        setAnimKey((k) => k + 1);
        return next;
      });
    }, AUTO_INTERVAL);
  }

  useEffect(() => {
    if (!paused) startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [paused]);

  return (
    <LandingSection
      id="industries"
      reveal={false}
      className="border-t border-zinc-100 dark:border-zinc-900/60 py-24"
    >
      <LandingContainer>

        {/* ── Section label ──────────────────────────────────────────── */}
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
          Agent Domain Presets
        </p>

        {/* ── Tab strip ─────────────────────────────────────────────── */}
        <div className="mt-6 flex justify-center">
          <div className="flex items-center gap-0.5 rounded-2xl border border-zinc-200/60 bg-white/60 p-1.5 shadow-sm dark:border-zinc-800/50 dark:bg-zinc-900/50">
            {INDUSTRIES.map((ind, idx) => {
              const isActive = idx === activeIdx;
              return (
                <button
                  key={ind.id}
                  onClick={() => selectTab(idx)}
                  className={`relative rounded-xl px-4 py-1.5 text-[13px] font-semibold transition-all duration-200 cursor-pointer border ${
                    isActive
                      ? "bg-white dark:bg-zinc-800 border-zinc-200/80 dark:border-zinc-700/60 text-zinc-900 dark:text-zinc-50 shadow-sm"
                      : "border-transparent text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {ind.name}
                  {isActive && (
                    <span
                      className="absolute bottom-1 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full"
                      style={{ background: ind.hex }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Illustration card — auto-cycles ───────────────────────── */}
        <div
          className="mt-8 relative flex h-[220px] w-full items-center justify-center rounded-2xl border border-zinc-200/60 dark:border-zinc-800/50 bg-zinc-50/40 dark:bg-zinc-900/20 overflow-hidden"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* Dot-grid background */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgba(0,0,0,0.045)_1px,transparent_1px)] dark:bg-[radial-gradient(circle,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:20px_20px]" />

          {/* Illustration with fade transition */}
          <div
            key={animKey}
            className="relative flex h-full w-full items-center justify-center px-8"
            style={{ animation: "ic-in 0.3s ease-out both" }}
          >
            <Illustration />
          </div>

          {/* Progress bar */}
          {!paused && (
            <div className="absolute bottom-0 left-0 h-[2px] w-full bg-zinc-100 dark:bg-zinc-800/60">
              <div
                key={`bar-${animKey}`}
                className="h-full bg-zinc-300 dark:bg-zinc-600 origin-left"
                style={{ animation: `ic-bar ${AUTO_INTERVAL}ms linear both` }}
              />
            </div>
          )}
        </div>

        {/* ── Tagline ───────────────────────────────────────────────── */}
        <div
          key={`tagline-${animKey}`}
          className="mt-8 text-center"
          style={{ animation: "ic-in 0.2s ease-out both" }}
        >
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            {active.tagline}
          </h2>
        </div>

        {/* ── Agent chips ───────────────────────────────────────────── */}
        <ul
          key={`agents-${animKey}`}
          className="mt-8 flex flex-wrap justify-center gap-2.5"
          style={{ animation: "ic-in 0.25s ease-out 0.06s both" }}
        >
          {active.agents.map((agent) => (
            <li
              key={agent.role}
              className="flex items-center gap-2.5 rounded-2xl border border-zinc-100 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/50 pl-1.5 pr-4 py-1.5 shadow-sm transition-all duration-200 hover:border-zinc-200 dark:hover:border-zinc-700/60 hover:shadow-md"
            >
              <Avatar name={agent.name} />
              <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                {agent.name}
              </span>
              <span
                className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
                style={{
                  background:
                    agent.status === "active"  ? "#34d399" :
                    agent.status === "preview" ? "#94a3b8" : "#71717a",
                }}
              />
            </li>
          ))}
        </ul>

      </LandingContainer>

      <style>{`
        @keyframes ic-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ic-bar {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
      `}</style>
    </LandingSection>
  );
}
