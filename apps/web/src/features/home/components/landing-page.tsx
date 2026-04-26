import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  Boxes,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Eye,
  FileCode2,
  Fingerprint,
  GitBranch,
  Lock,
  PlayCircle,
  Rocket,
  ScanSearch,
  Shield,
  ShieldCheck,
  TerminalSquare,
  Users,
  Workflow,
} from "lucide-react";

const headerLinks = ["Features", "Docs", "Integrations", "Pricing", "Security", "Changelog"];

const capabilityCards = [
  {
    icon: Bot,
    title: "Agent Lifecycle",
    text: "Create, deploy, pause, and version agents across teams and projects.",
  },
  {
    icon: Shield,
    title: "Policy & Access Control",
    text: "Fine-grained RBAC, tool access, repo scope, APIs, and approvals.",
  },
  {
    icon: Eye,
    title: "Full Observability",
    text: "Track every agent, change, cost, and approval in one dashboard.",
  },
  {
    icon: Boxes,
    title: "Multi-Environment Execution",
    text: "Run agents locally, across runners, or in isolated cloud sandboxes.",
  },
  {
    icon: Workflow,
    title: "Tool Integration Control",
    text: "Securely connect git, docs, issues, CI, and extensions.",
  },
  {
    icon: ClipboardCheck,
    title: "Audit & Compliance",
    text: "Immutable logs, approvals, and exportable posture for enterprise needs.",
  },
];

const securityPillars = [
  {
    icon: Lock,
    title: "Isolated Sandboxes",
    text: "Run agents in containers with policy boundaries.",
  },
  {
    icon: Fingerprint,
    title: "No Client-Side Keys",
    text: "API keys stay on local server or secured backend.",
  },
  {
    icon: ShieldCheck,
    title: "Least-Privilege Access",
    text: "Granular permissions for repos, tools, and environments.",
  },
  {
    icon: ScanSearch,
    title: "Immutable Audit Logs",
    text: "Preserve every decision, action, and approval event.",
  },
];

const teamCards = [
  {
    icon: Building2,
    title: "For CTOs",
    items: ["Gain visibility into engineering output", "Control costs and measure usage", "Ensure compliance and security"],
  },
  {
    icon: Cpu,
    title: "For Developers",
    items: ["Accelerate repetitive coding tasks", "Test new flows with runner switching", "Stay in control of your codebase"],
  },
  {
    icon: Users,
    title: "For Enterprises",
    items: ["Meet compliance requirements", "Protect IP and sensitive code", "Self-host or deploy in your cloud"],
  },
];

export function LandingPage() {
  return (
    <main className="bg-zinc-50 text-zinc-950 dark:bg-[#040712] dark:text-zinc-100">
      <div className="mx-auto max-w-[1180px] px-4 py-4 md:px-6 md:py-6">
        <header className="surface-panel flex items-center justify-between rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500 text-xs font-semibold text-white">
              UJ
            </span>
            <span className="text-sm font-semibold text-zinc-950 dark:text-white">Ujima Agents</span>
          </div>
          <nav className="hidden items-center gap-5 md:flex">
            {headerLinks.map((item) => (
              <a key={item} href="#" className="text-xs text-zinc-500 transition hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white">
                {item}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a href="#" className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5">
              Sign in
            </a>
            <Link href="/onboarding" className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-400">
              Get Started
            </Link>
          </div>
        </header>

        <section className="surface-hero tech-grid mt-6 rounded-[28px] border border-zinc-200 p-6 shadow-[0_16px_48px_rgba(15,23,42,0.08)] md:p-8">
          <div className="grid items-start gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="pt-3">
              <div className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-200">
                Open Source · 100% Secure
              </div>
              <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-tight tracking-tight text-zinc-950 dark:text-white md:text-6xl">
                Control Your AI Agents.
                <br />
                Ship Code Faster.
                <br />
                <span className="text-violet-300">Stay Secure.</span>
              </h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
                The open-source control plane for deploying, governing, and observing AI software agents. Run locally or in the cloud with approvals, telemetry, and strong access boundaries.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/onboarding" className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-400">
                  Get Started Free
                </Link>
                <a href="#" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10">
                  View on GitHub
                </a>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-500">
                <InlineMeta icon={ShieldCheck} label="Self-hosted" />
                <InlineMeta icon={GitBranch} label="No vendor lock-in" />
                <InlineMeta icon={Lock} label="Privacy-first" />
              </div>
            </div>

            <div className="surface-visual self-stretch rounded-[24px] border border-zinc-200 bg-[#f5f7fb] p-4 shadow-[0_20px_60px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-[#0c1021] dark:shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <div className="surface-panel rounded-[18px] border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-[#11162d]">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-white/5">Runs</span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-300">PR #2781</span>
                  </div>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-500">View logs</span>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="surface-subpanel rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#0a0e1d]">
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">PR: Add user analytics tracking</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <StatMini label="Files changed" value="13" />
                      <StatMini label="Coverage" value="98%" />
                      <StatMini label="Tests" value="21" />
                    </div>
                    <div className="surface-panel mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-[#0d1328]">
                      <div className="flex items-end justify-between gap-2">
                        <div className="space-y-1 text-[11px] text-zinc-500 dark:text-zinc-500">
                          <p>Spend</p>
                          <p className="text-lg font-semibold text-zinc-950 dark:text-white">$0.48</p>
                        </div>
                        <div className="space-y-1 text-right text-[11px] text-zinc-500 dark:text-zinc-500">
                          <p>Tokens</p>
                          <p className="text-lg font-semibold text-zinc-950 dark:text-white">128,942</p>
                        </div>
                      </div>
                      <AnalyticsLineChart />
                    </div>
                  </div>
                  <div className="surface-subpanel rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#0a0e1d]">
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">State</p>
                    <ul className="mt-3 space-y-2 text-xs text-zinc-700 dark:text-zinc-300">
                      <StatusDot label="Planning" color="bg-emerald-400" />
                      <StatusDot label="Code changes" color="bg-blue-400" />
                      <StatusDot label="Tests" color="bg-violet-400" />
                      <StatusDot label="Approved" color="bg-zinc-500" />
                    </ul>
                    <div className="surface-panel mt-4 space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-[#0d1328]">
                      <ProgressRow label="Approval rate" value="96%" width="w-[96%]" />
                      <ProgressRow label="Issues closed" value="87%" width="w-[87%]" />
                      <ProgressRow label="Coverage delta" value="91%" width="w-[91%]" />
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-200">
                  diff validated: permissions.ts + dashboard.tsx + telemetry.ts
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <PanelCard
            tone="red"
            icon={AlertTriangle}
            title="The Problem"
            items={[
              { icon: Eye, text: "No visibility into what agents do or change" },
              { icon: Shield, text: "No governance over tools, data, and access" },
              { icon: Fingerprint, text: "Secrets and APIs exposed without controls" },
              { icon: ClipboardCheck, text: "No audit trail for compliance and approvals" },
            ]}
          />
          <PanelCard
            tone="green"
            icon={CheckCircle2}
            title="The Solution"
            items={[
              { icon: Boxes, text: "Deploy agents safely with local + hybrid execution" },
              { icon: ShieldCheck, text: "Policy-driven governance and approvals" },
              { icon: Activity, text: "Full observability, logging, and cost tracking" },
              { icon: Lock, text: "Run locally or in secure cloud environments" },
            ]}
          />
        </section>

        <section className="mt-6">
          <SectionTitle title="Everything you need to manage AI agents" />
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {capabilityCards.map((card) => (
              <article key={card.title} className="surface-panel rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-blue-500/10 p-2 text-blue-600 dark:text-blue-300">
                    <card.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-white">{card.title}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{card.text}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <SectionTitle title="How it works" />
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <WorkflowCard step="1" icon={Bot} title="Create an Agent" description="Define the agent role, tools, and permissions." />
            <WorkflowCenterCard />
            <WorkflowCard step="3" icon={ClipboardCheck} title="Review & Approve" description="Review every change, log, and action before merging." />
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[0.85fr,1.15fr]">
          <div className="surface-panel rounded-[24px] border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">One Dashboard. Complete Control.</p>
            <h2 className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-white">Manage agents, runs, policies, and activity from one place.</h2>
            <ul className="mt-5 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="flex items-center gap-2"><Activity className="h-4 w-4 text-blue-500" /> Real-time run logs and status</li>
              <li className="flex items-center gap-2"><FileCode2 className="h-4 w-4 text-violet-500" /> Costs, diffs, and artifacts</li>
              <li className="flex items-center gap-2"><TerminalSquare className="h-4 w-4 text-emerald-500" /> Central tool usage analytics</li>
              <li className="flex items-center gap-2"><Users className="h-4 w-4 text-cyan-500" /> Team activity and approvals</li>
            </ul>
            <Link href="/onboarding" className="mt-6 inline-flex rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-400">
              Explore the Dashboard
            </Link>
          </div>
          <div className="surface-visual rounded-[24px] border border-zinc-200 bg-[#f5f7fb] p-5 shadow-sm dark:border-white/10 dark:bg-[#0c1021]">
            <div className="surface-panel rounded-[20px] border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-[#11162d]">
              <div className="grid gap-4 lg:grid-cols-4">
                <StatMini label="Active runs" value="1,782" />
                <StatMini label="Success rate" value="98.6%" />
                <StatMini label="Total spend" value="$432.18" />
                <StatMini label="Tasks today" value="24" />
              </div>
              <div className="surface-subpanel mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#0d1328]">
                <DashboardAnalytics />
              </div>
            </div>
          </div>
        </section>

        <section className="surface-panel mt-6 rounded-[24px] border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Security by design</p>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-white">Built with security best practices to protect your code, data, and teams.</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {securityPillars.map((item) => (
              <article key={item.title} className="surface-subpanel rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#0a0e1d]">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-violet-500/10 p-2 text-violet-600 dark:text-violet-300">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-white">{item.title}</p>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{item.text}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          {teamCards.map((team) => (
            <article key={team.title} className="surface-panel rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-blue-500/10 p-2 text-blue-600 dark:text-blue-300">
                  <team.icon className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold text-zinc-950 dark:text-white">{team.title}</p>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                {team.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[0.9fr,1.1fr]">
          <div className="surface-panel rounded-[24px] border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Open Source. Built for Builders.</p>
            <h2 className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-white">Self-host, extend, and make it your own.</h2>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Ujima is built to support secure local teams, extensible toolchains, and open-source driven workflows.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a href="https://github.com" target="_blank" rel="noreferrer" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-950 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10">
                Star on GitHub
              </a>
              <Link href="/onboarding" className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-400">
                Self-host in Minutes
              </Link>
            </div>
          </div>
          <div className="surface-hero rounded-[24px] border border-zinc-200 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.12),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,244,245,0.92))] p-6 shadow-sm dark:border-white/10 dark:bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.25),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]">
            <div className="surface-panel flex h-full min-h-[220px] items-center justify-center rounded-[20px] border border-zinc-200 bg-white dark:border-white/10 dark:bg-[#0b0f1e]">
              <Rocket className="h-12 w-12 text-blue-500 dark:text-blue-300" />
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-[24px] border border-violet-500/30 bg-[linear-gradient(90deg,rgba(59,130,246,0.2),rgba(139,92,246,0.25))] px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xl font-semibold text-white">Start managing your AI agents today</p>
              <p className="mt-1 text-sm text-blue-100/80">Get up and running in minutes. No credit card required.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/onboarding" className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200">
                Get Started Free
              </Link>
              <a href="#" className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10">
                Read the Docs
              </a>
            </div>
          </div>
        </section>

        <footer className="surface-panel mt-6 rounded-[24px] border border-zinc-200 bg-white px-6 py-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))]">
            <div>
              <p className="text-sm font-semibold text-zinc-950 dark:text-white">Ujima Agents</p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                The open-source control plane for AI agents. Deploy, govern, and observe with confidence.
              </p>
              <div className="mt-4 flex items-center gap-3">
                <a href="https://github.com" target="_blank" rel="noreferrer" className="rounded-lg border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5">
                  <GitBranch className="h-4 w-4" />
                </a>
                <a href="#" className="rounded-lg border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5">
                  <BookOpen className="h-4 w-4" />
                </a>
                <a href="#" className="rounded-lg border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5">
                  <Users className="h-4 w-4" />
                </a>
              </div>
            </div>
            <FooterList title="Product" items={["Features", "Docs", "Integrations", "Changelog"]} />
            <FooterList title="Resources" items={["Documentation", "API Reference", "Blog", "Community"]} />
            <FooterList title="Company" items={["About", "Security", "Contact", "License"]} />
            <FooterList title="Legal" items={["Privacy Policy", "Terms of Service", "Security Policy"]} />
          </div>
          <div className="mt-6 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-500">
            Copyright {new Date().getFullYear()} Ujima Agents. All rights reserved.
          </div>
        </footer>
      </div>
    </main>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-panel rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-950 dark:text-white">{value}</p>
    </div>
  );
}

function StatusDot({ label, color }: { label: string; color: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span>{label}</span>
    </li>
  );
}

function PanelCard({
  title,
  items,
  tone,
  icon: Icon,
}: {
  title: string;
  items: { icon: LucideIcon; text: string }[];
  tone: "red" | "green";
  icon: LucideIcon;
}) {
  return (
    <article
      className={`rounded-[22px] border p-5 ${
        tone === "red"
          ? "border-red-300 bg-[linear-gradient(180deg,rgba(254,242,242,0.95),rgba(255,255,255,1))] dark:border-red-500/20 dark:bg-[linear-gradient(180deg,rgba(127,29,29,0.18),rgba(255,255,255,0.03))]"
          : "border-emerald-300 bg-[linear-gradient(180deg,rgba(236,253,245,0.95),rgba(255,255,255,1))] dark:border-emerald-500/20 dark:bg-[linear-gradient(180deg,rgba(6,95,70,0.18),rgba(255,255,255,0.03))]"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`rounded-xl p-2 ${tone === "red" ? "bg-red-500/10 text-red-600 dark:text-red-300" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"}`}>
          <Icon className="h-5 w-5" />
        </span>
        <p className={`text-sm font-semibold ${tone === "red" ? "text-red-700 dark:text-red-200" : "text-emerald-700 dark:text-emerald-200"}`}>{title}</p>
      </div>
      <ul className="mt-4 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-3">
            <item.icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "red" ? "text-red-500" : "text-emerald-500"}`} />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="text-center text-2xl font-semibold text-zinc-950 dark:text-white">{title}</h2>
  );
}

function WorkflowCard({ step, title, description, icon: Icon }: { step: string; title: string; description: string; icon: LucideIcon }) {
  return (
    <article className="surface-panel rounded-[22px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Step {step}</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="rounded-xl bg-blue-500/10 p-2 text-blue-600 dark:text-blue-300">
          <Icon className="h-5 w-5" />
        </span>
        <p className="text-lg font-semibold text-zinc-950 dark:text-white">{title}</p>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
      <div className="surface-subpanel mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#0b0f1e]">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-white px-3 py-4 dark:bg-white/5" />
          <div className="rounded-lg bg-white px-3 py-4 dark:bg-white/5" />
          <div className="rounded-lg bg-white px-3 py-4 dark:bg-white/5" />
        </div>
      </div>
    </article>
  );
}

function WorkflowCenterCard() {
  return (
    <article className="surface-panel rounded-[22px] border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">Step 2</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="rounded-xl bg-violet-500/10 p-2 text-violet-600 dark:text-violet-300">
          <PlayCircle className="h-5 w-5" />
        </span>
        <p className="text-lg font-semibold text-zinc-950 dark:text-white">Run Tasks</p>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Agents execute securely across local and isolated environments.</p>
      <div className="surface-subpanel mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-[#0b0f1e]">
        <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          <li>Agent role is loading...</li>
          <li>Planning workflow...</li>
          <li>Analyzing repo...</li>
          <li>Creating pull request...</li>
        </ul>
      </div>
    </article>
  );
}

function FooterList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-zinc-950 dark:text-white">{title}</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="text-sm text-zinc-600 dark:text-zinc-400">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InlineMeta({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function ProgressRow({ label, value, width }: { label: string; value: string; width: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-500">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-200 dark:bg-white/10">
        <div className={`h-2 rounded-full bg-blue-500 ${width}`} />
      </div>
    </div>
  );
}

function AnalyticsLineChart() {
  return (
    <svg viewBox="0 0 320 120" className="mt-4 h-28 w-full">
      <defs>
        <linearGradient id="heroArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(59,130,246,0.45)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0.02)" />
        </linearGradient>
      </defs>
      <path d="M0 88 C30 76, 52 78, 74 64 S120 30, 150 44 S200 98, 230 74 S280 56, 320 66" fill="none" stroke="rgb(59 130 246)" strokeWidth="3" />
      <path d="M0 120 L0 88 C30 76, 52 78, 74 64 S120 30, 150 44 S200 98, 230 74 S280 56, 320 66 L320 120 Z" fill="url(#heroArea)" />
    </svg>
  );
}

function DashboardAnalytics() {
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-[1.5fr,1fr]">
        <svg viewBox="0 0 420 170" className="h-44 w-full">
          <defs>
            <linearGradient id="dashArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(99,102,241,0.35)" />
              <stop offset="100%" stopColor="rgba(99,102,241,0.02)" />
            </linearGradient>
          </defs>
          <path d="M10 132 C55 118, 82 120, 120 95 S188 58, 230 78 S300 142, 345 108 S392 80, 410 92" fill="none" stroke="rgb(99 102 241)" strokeWidth="3" />
          <path d="M10 170 L10 132 C55 118, 82 120, 120 95 S188 58, 230 78 S300 142, 345 108 S392 80, 410 92 L410 170 Z" fill="url(#dashArea)" />
        </svg>
        <div className="space-y-3">
          <MiniBar label="Top Agent: pm-bot" value="$102.43" width="w-[88%]" />
          <MiniBar label="reviewer-bot" value="$84.19" width="w-[72%]" />
          <MiniBar label="frontend-bot" value="$64.01" width="w-[58%]" />
        </div>
      </div>
    </div>
  );
}

function MiniBar({ label, value, width }: { label: string; value: string; width: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-500">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-200 dark:bg-white/10">
        <div className={`h-2 rounded-full bg-violet-500 ${width}`} />
      </div>
    </div>
  );
}
