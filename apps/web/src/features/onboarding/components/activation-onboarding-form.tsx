"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Bot, Check, Eye, EyeOff, FolderKanban, Search, Server, ShieldCheck } from "lucide-react";
import { FieldShell, TextInput } from "@/components/ui/form-fields";
import { Select } from "@/components/ui/select";
import { ProviderCredentialField } from "@/features/providers/provider-credential-field";
import {
  PROVIDER_OPTIONS,
  resolveInternalProviderToken,
  resolveUiProviderToken,
  resolveAuthMode,
  type OpenAIAuthMode,
} from "@/features/providers/catalog";
import { defaultModelForProvider, type OnboardingDraft, type OnboardingStep, type RolePresetTemplate } from "../types";
import { getSuggestedAgentName } from "../agent-name-suggestions";

interface Props {
  step: OnboardingStep;
  draft: OnboardingDraft;
  roleTemplates: RolePresetTemplate[];
  onChange: (draft: OnboardingDraft) => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  canGoBack: boolean;
  isSubmitting: boolean;
  submitError: string | null;
}

const panel = "rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950";

export function ActivationOnboardingForm(props: Props) {
  const { step, draft, roleTemplates, onChange } = props;
  const [attempted, setAttempted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [roleIndustry, setRoleIndustry] = useState("all");
  const [codexConnected, setCodexConnected] = useState(false);

  const error = useMemo(() => {
    if (step.id === "owner") {
      if (!draft.ownerName.trim()) return "Enter your name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.ownerEmail.trim())) return "Enter a valid email address.";
      if (draft.ownerPassword.length < 8) return "Use at least 8 characters for your password.";
      if (draft.ownerPassword !== draft.ownerPasswordConfirmation) return "Passwords do not match.";
    }
    if (step.id === "organization") {
      if (!draft.organizationName.trim()) return "Enter a workspace name.";
      if (!draft.workspaceRoot.trim()) return "Choose or enter a project folder.";
    }
    if (step.id === "provider") {
      const provider = draft.providers[0];
      if (!provider?.name) return "Choose a provider.";
      // provider.name is already the internal token (openai / openai-codex / anthropic ...)
      if (provider.name !== "ollama" && provider.name !== "openai-codex" && !provider.apiKey.trim()) return "Enter the provider API key.";
      if (provider.name === "openai-codex" && !codexConnected) return "Connect ChatGPT subscription.";
    }
    if (step.id === "agent") {
      const role = draft.roles[0];
      if (!role?.agentName.trim()) return "Name your starter agent.";
      if (!role.name.trim()) return "Choose a starter role.";
    }
    return null;
  }, [draft, step.id]);

  const update = <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const pickFolder = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const response = await fetch("/api/onboarding/pick-workspace-root", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { path?: string; message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "Unable to open folder picker.");
      if (body?.path) update("workspaceRoot", body.path);
    } catch (cause) {
      setPickError(cause instanceof Error ? cause.message : "Unable to open folder picker.");
    } finally {
      setPicking(false);
    }
  };

  const continueFlow = () => {
    setAttempted(true);
    if (error) return;
    if (step.id === "review") props.onSubmit();
    else props.onNext();
  };

  const provider = draft.providers[0];
  const role = draft.roles[0];
  const defaultTemplate = {
    name: "senior-engineer",
    title: role?.title || "Software Engineer",
    description: role?.instructions || "Build, debug, and improve software.",
    instructions: role?.instructions || "Build, debug, and improve software.",
    channels: ["general"],
    industry: "general",
    key: "senior-engineer",
  };
  const templates = roleTemplates.some((template) => template.name === role?.name)
    ? roleTemplates
    : [defaultTemplate, ...roleTemplates];
  const industries = Array.from(new Set(templates.map((template) => template.industry))).sort();
  const visibleTemplates = templates
    .filter((template) => {
      if (roleIndustry !== "all" && template.industry !== roleIndustry) return false;
      const query = roleSearch.trim().toLowerCase();
      if (!query) return true;
      return `${template.title} ${template.name} ${template.description} ${template.industry}`
        .toLowerCase()
        .includes(query);
    })
    .sort((left, right) => {
      const leftSelected = left.name === role.name;
      const rightSelected = right.name === role.name;
      if (leftSelected === rightSelected) return left.title.localeCompare(right.title);
      return leftSelected ? -1 : 1;
    });

  return (
    <section className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{step.title}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{step.description}</p>

        <div className="mt-7">
          {step.id === "owner" ? (
            <div className={panel}>
              <div className="mb-5 flex gap-3 rounded-lg bg-violet-50 p-4 text-sm text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">
                <ShieldCheck className="h-5 w-5 shrink-0" />
                This owner account controls agents, approvals, and workspace settings.
              </div>
              <div className="space-y-5">
                <FieldShell label="Full name" htmlFor="ownerName"><TextInput id="ownerName" value={draft.ownerName} onChange={(e) => update("ownerName", e.target.value)} placeholder="Alex Developer" /></FieldShell>
                <FieldShell label="Email" htmlFor="ownerEmail"><TextInput id="ownerEmail" type="email" value={draft.ownerEmail} onChange={(e) => update("ownerEmail", e.target.value)} placeholder="alex@company.com" /></FieldShell>
                <FieldShell label="Password" htmlFor="ownerPassword" hint="Minimum 8 characters.">
                  <div className="relative">
                    <TextInput id="ownerPassword" type={showPassword ? "text" : "password"} className="pr-11" value={draft.ownerPassword} onChange={(e) => update("ownerPassword", e.target.value)} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 w-11 text-zinc-400" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="mx-auto h-4 w-4" /> : <Eye className="mx-auto h-4 w-4" />}</button>
                  </div>
                </FieldShell>
                <FieldShell label="Confirm password" htmlFor="ownerPasswordConfirmation"><TextInput id="ownerPasswordConfirmation" type={showPassword ? "text" : "password"} value={draft.ownerPasswordConfirmation} onChange={(e) => update("ownerPasswordConfirmation", e.target.value)} /></FieldShell>
              </div>
            </div>
          ) : null}

          {step.id === "organization" ? (
            <div className={panel}>
              <div className="mb-5 flex items-center gap-3"><FolderKanban className="h-5 w-5 text-violet-600" /><p className="text-sm text-zinc-600 dark:text-zinc-300">Agents stay inside this project folder.</p></div>
              <div className="space-y-5">
                <FieldShell label="Workspace name" htmlFor="organizationName"><TextInput id="organizationName" value={draft.organizationName} onChange={(e) => update("organizationName", e.target.value)} placeholder="Acme Product" /></FieldShell>
                <FieldShell label="Project folder" htmlFor="workspaceRoot">
                  <div className="flex gap-2">
                    <TextInput id="workspaceRoot" className="flex-1" value={draft.workspaceRoot} onChange={(e) => update("workspaceRoot", e.target.value)} placeholder="Absolute path to your project" />
                    <button type="button" disabled={picking} onClick={() => void pickFolder()} className="rounded-lg border border-zinc-200 px-4 text-sm font-medium dark:border-zinc-700">{picking ? "Opening..." : "Browse"}</button>
                  </div>
                  {pickError ? <p className="mt-2 text-xs text-red-600">{pickError}</p> : null}
                </FieldShell>
              </div>
            </div>
          ) : null}

          {step.id === "provider" && provider ? (
            <div className={panel}>
              <div className="mb-5 flex items-center gap-3"><Server className="h-5 w-5 text-violet-600" /><p className="text-sm text-zinc-600 dark:text-zinc-300">Credentials are submitted once and are never saved in browser storage.</p></div>
              <div className="space-y-5">
                <FieldShell label="Provider" htmlFor="provider">
                  {/* Show "openai" in dropdown even when internal token is "openai-codex" */}
                  <Select id="provider" value={resolveUiProviderToken(provider.name)} options={PROVIDER_OPTIONS.map((item) => ({ value: item.token, label: item.label }))} onChange={(e) => {
                    const uiToken = e.target.value;
                    // Always reset to apikey when switching providers
                    const internalName = resolveInternalProviderToken(uiToken, "apikey");
                    setCodexConnected(false);
                    onChange({ ...draft, providers: [{ ...provider, name: internalName, apiKey: "" }], roles: draft.roles.map((item) => ({ ...item, llm: internalName, model: defaultModelForProvider(internalName) })) });
                  }} />
                </FieldShell>
                <ProviderCredentialField
                  provider={resolveUiProviderToken(provider.name)}
                  apiKey={provider.apiKey}
                  onApiKeyChange={(apiKey) => onChange({ ...draft, providers: [{ ...provider, apiKey }] })}
                  authMode={resolveAuthMode(provider.name) ?? "apikey"}
                  onAuthModeChange={(mode: OpenAIAuthMode) => {
                    // Encode auth mode directly in provider name
                    const internalName = resolveInternalProviderToken("openai", mode);
                    setCodexConnected(false);
                    onChange({ ...draft, providers: [{ ...provider, name: internalName, apiKey: "" }], roles: draft.roles.map((item) => ({ ...item, llm: internalName })) });
                  }}
                  onCodexConnectionChange={setCodexConnected}
                />
              </div>
            </div>
          ) : null}

          {step.id === "agent" && role ? (
            <div className={panel}>
              <div className="mb-5 flex items-center gap-3"><Bot className="h-5 w-5 text-violet-600" /><p className="text-sm text-zinc-600 dark:text-zinc-300">Start with one agent. Add teammates, channels, and org structure later.</p></div>
              <div className="space-y-5">
                <FieldShell label="Starter role" htmlFor="starterRoleSearch" hint={`${templates.length} roles available`}>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-400" />
                    <TextInput
                      id="starterRoleSearch"
                      className="pl-9"
                      value={roleSearch}
                      onChange={(event) => setRoleSearch(event.target.value)}
                      placeholder="Search roles, industries, or skills"
                    />
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {["all", ...industries].map((industry) => (
                      <button
                        key={industry}
                        type="button"
                        onClick={() => setRoleIndustry(industry)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium capitalize transition ${
                          roleIndustry === industry
                            ? "bg-violet-600 text-white"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {industry === "all" ? "All roles" : industry}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {visibleTemplates.map((template) => {
                        const selected = template.name === role.name;
                        return (
                          <button
                            key={template.key}
                            type="button"
                            onClick={() => {
                              const agentName = role.agentName || getSuggestedAgentName();
                              onChange({
                                ...draft,
                                roles: [{
                                  ...role,
                                  name: template.name,
                                  title: template.title,
                                  instructions: template.instructions,
                                  agentName,
                                }],
                                organizationReports: [{
                                  id: "report-starter",
                                  subjectName: agentName,
                                  managerName: "@owner",
                                }],
                              });
                            }}
                            className={`flex w-full gap-3 px-4 py-3 text-left transition ${
                              selected
                                ? "bg-violet-50 dark:bg-violet-500/10"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                  {template.title}
                                </span>
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                  {template.industry}
                                </span>
                              </span>
                              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                                {template.description}
                              </span>
                            </span>
                            {selected ? <Check className="mt-1 h-4 w-4 shrink-0 text-violet-600" /> : null}
                          </button>
                        );
                      })}
                      {visibleTemplates.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-zinc-500">No roles match that search.</p>
                      ) : null}
                    </div>
                  </div>
                </FieldShell>
                <FieldShell label="Agent name" htmlFor="agentName"><TextInput id="agentName" value={role.agentName} onChange={(e) => {
                  const agentName = e.target.value;
                  onChange({ ...draft, roles: [{ ...role, agentName }], organizationReports: [{ id: "report-starter", subjectName: agentName, managerName: "@owner" }] });
                }} /></FieldShell>
              </div>
            </div>
          ) : null}

          {step.id === "review" ? (
            <div className={panel}>
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Ready to create your workspace</h2>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-zinc-500">Owner</dt><dd className="mt-1 font-medium">{draft.ownerName} · {draft.ownerEmail}</dd></div>
                <div><dt className="text-zinc-500">Workspace</dt><dd className="mt-1 font-medium">{draft.organizationName}</dd></div>
                <div><dt className="text-zinc-500">Provider</dt><dd className="mt-1 font-medium">{provider?.name}</dd></div>
                <div><dt className="text-zinc-500">Starter agent</dt><dd className="mt-1 font-medium">{role?.agentName} · {role?.title}</dd></div>
              </dl>
              <p className="mt-6 text-sm text-zinc-500">Recommended defaults create #general, hard workspace boundaries, write approval, and shell review. You can customize the full team after setup.</p>
            </div>
          ) : null}
        </div>

        {attempted && error ? <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{error}</p> : null}
        {props.submitError ? <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{props.submitError}</p> : null}

        <div className="mt-7 flex items-center justify-between">
          <button type="button" onClick={props.onBack} disabled={!props.canGoBack || props.isSubmitting} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm disabled:opacity-40 dark:border-zinc-700"><ArrowLeft className="h-4 w-4" />Back</button>
          <button type="button" onClick={continueFlow} disabled={props.isSubmitting} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">{props.isSubmitting ? "Creating..." : step.id === "review" ? "Create workspace" : "Continue"}<ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </section>
  );
}
