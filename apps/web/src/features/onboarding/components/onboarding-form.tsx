import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Eye,
  EyeOff,
  FolderKanban,
  Hash,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { formatProviderLabel } from "../api-contract";
import {
  OWNER_MANAGER_SENTINEL,
  type OnboardingDraft,
  type OnboardingStep,
  type OnboardingStepId,
  type TeamTabId,
} from "../types";

interface OnboardingFormProps {
  step: OnboardingStep;
  stepIndex: number;
  totalSteps: number;
  draft: OnboardingDraft;
  onDraftChange: (next: OnboardingDraft) => void;
  activeTeamTab: TeamTabId;
  onTeamTabChange: (tabId: TeamTabId) => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: (draft: OnboardingDraft) => Promise<void> | void;
  canGoBack: boolean;
  isLastStep: boolean;
  isSubmitting: boolean;
  submitError: string | null;
}

type DraftField = keyof OnboardingDraft | "teamConfig";
type DraftErrors = Partial<Record<DraftField, string>>;

function updateField<K extends keyof OnboardingDraft>(
  draft: OnboardingDraft,
  key: K,
  value: OnboardingDraft[K],
): OnboardingDraft {
  return { ...draft, [key]: value };
}

function validateStep(stepId: OnboardingStepId, draft: OnboardingDraft, activeTeamTab: TeamTabId): DraftErrors {
  const errors: DraftErrors = {};

  if (stepId === "organization" || stepId === "review") {
    if (!draft.organizationName.trim()) {
      errors.organizationName = "Enter your organization name.";
    }

    if (!draft.workspaceRoot.trim()) {
      errors.workspaceRoot = "Choose or enter a workspace root.";
    }
  }

  if (stepId === "owner" || stepId === "review") {
    if (!draft.ownerName.trim()) {
      errors.ownerName = "Enter the full name for the first owner.";
    }

    if (!draft.ownerEmail.trim()) {
      errors.ownerEmail = "Enter the owner email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.ownerEmail.trim())) {
      errors.ownerEmail = "Enter a valid owner email address.";
    }

    if (!draft.ownerPassword.trim()) {
      errors.ownerPassword = "Enter the owner password.";
    } else if (draft.ownerPassword.trim().length < 8) {
      errors.ownerPassword = "Use at least 8 characters for the owner password.";
    }
  }

  if (stepId === "team") {
    const teamTabError = validateTeamTab(activeTeamTab, draft);

    if (teamTabError) {
      errors.teamConfig = teamTabError;
    }
  }

  if (stepId === "review") {
    for (const tabId of TEAM_TABS.map((tab) => tab.id)) {
      const teamTabError = validateTeamTab(tabId, draft);

      if (teamTabError) {
        errors.teamConfig = teamTabError;
        break;
      }
    }
  }

  return errors;
}

function getValidationMessage(stepId: OnboardingStepId, errors: DraftErrors): string | null {
  if (Object.keys(errors).length === 0) {
    return null;
  }

  if (stepId === "organization") {
    return "Fill in the organization name and workspace root before continuing.";
  }

  if (stepId === "owner") {
    return "Complete the owner account details before continuing.";
  }

  if (stepId === "team") {
    return errors.teamConfig ?? "Complete this team configuration tab before continuing.";
  }

  return "Resolve the missing onboarding details before creating the organization.";
}

function OrganizationPreviewCard() {
  return (
    <div className="rounded-2xl bg-violet-50 p-6 dark:bg-violet-500/10">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-zinc-900 dark:text-violet-300">
        <FolderKanban className="h-5 w-5" />
      </div>
      <p className="mt-6 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Workspace boundary</p>
      <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
        All agents will operate within the configured workspace boundary for maximum safety.
      </p>
      <button
        type="button"
        className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-violet-700 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
      >
        Learn more
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function OwnerPreviewCard() {
  return (
    <div className="rounded-2xl bg-violet-50 p-6 dark:bg-violet-500/10">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-zinc-900 dark:text-violet-300">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <p className="mt-6 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Owner permissions</p>
      <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
        The onboarding API currently creates the first owner from the full name field and stores the person as the initial human member.
      </p>
    </div>
  );
}

const TEAM_TABS: { id: TeamTabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "agents", label: "Agents & Roles", icon: Users },
  { id: "channels", label: "Channels", icon: MessageSquare },
  { id: "org-chart", label: "Organization chart", icon: Building2 },
  { id: "policies", label: "Policies", icon: ShieldCheck },
  { id: "providers", label: "Providers", icon: Server },
];

const ONBOARDING_STEP_NEXT_LABELS: Record<OnboardingStepId, string> = {
  organization: "Owner account",
  owner: "Team configuration",
  team: "Review & create",
  review: "Complete",
};

const LLM_OPTIONS = ["Anthropic", "OpenAI", "Google", "Mistral"] as const;

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function toTitleCase(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function validateTeamTab(tabId: TeamTabId, draft: OnboardingDraft): string | null {
  if (tabId === "agents") {
    const hasValidRoles = draft.roles.every(
      (role) =>
        role.name.trim() &&
        role.llm.trim() &&
        role.channelIds.length > 0,
    );

    if (!hasValidRoles || draft.roles.length === 0) {
      return "Complete the role name, provider, and channel setup before continuing.";
    }
  }

  if (tabId === "channels" && draft.channels.some((channel) => !channel.name.trim() || !channel.description.trim())) {
    return "Complete all channel names and descriptions before continuing.";
  }

  if (
    tabId === "org-chart" &&
    draft.organizationReports.some((report) => !report.subjectName.trim() || !report.managerName.trim())
  ) {
    return "Complete all organization chart mappings before continuing.";
  }

  if (tabId === "providers" && draft.providers.some((provider) => !provider.name.trim() || !provider.apiKey.trim())) {
    return "Complete the provider names and API keys before continuing.";
  }

  return null;
}

function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100" htmlFor={htmlFor}>
        {label}
      </label>
      {hint ? <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">{hint}</span> : null}
      <div className="mt-3">{children}</div>
      {error ? (
        <p className="mt-2 flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-400" role="alert">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TeamConfigCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-[24px] border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ModalShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
      <div className="w-full max-w-xl rounded-[28px] border border-zinc-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)] dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function StepFields({
  stepId,
  draft,
  onDraftChange,
  errors,
  showError,
  onFieldBlur,
  onWorkspaceBrowse,
  directoryInputRef,
  onDirectoryInputChange,
  folderPickerNote,
  showOwnerPassword,
  onToggleOwnerPassword,
  activeTeamTab,
  onTeamTabChange,
}: {
  stepId: OnboardingStepId;
  draft: OnboardingDraft;
  onDraftChange: (next: OnboardingDraft) => void;
  errors: DraftErrors;
  showError: (field: DraftField) => boolean;
  onFieldBlur: (field: DraftField) => void;
  onWorkspaceBrowse: () => void;
  directoryInputRef: React.RefObject<HTMLInputElement | null>;
  onDirectoryInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  folderPickerNote: string;
  showOwnerPassword: boolean;
  onToggleOwnerPassword: () => void;
  activeTeamTab: TeamTabId;
  onTeamTabChange: (tabId: TeamTabId) => void;
}) {
  const [roleMenuId, setRoleMenuId] = useState<string | null>(null);
  const [roleEditor, setRoleEditor] = useState<{
    mode: "create" | "edit";
    roleId: string | null;
    name: string;
    llm: string;
    model: string;
    channelIds: string[];
  } | null>(null);
  const [channelEditor, setChannelEditor] = useState<{
    mode: "create" | "edit";
    channelId: string | null;
    name: string;
    description: string;
  } | null>(null);

  const ownerLabel = draft.ownerName.trim() || "Owner";

  const openRoleEditor = (roleId?: string) => {
    if (!roleId) {
      setRoleEditor({
        mode: "create",
        roleId: null,
        name: "",
        llm: "Anthropic",
        model: "claude-3-5-sonnet",
        channelIds: draft.channels.slice(0, 1).map((channel) => channel.id),
      });
      return;
    }

    const role = draft.roles.find((item) => item.id === roleId);

    if (!role) {
      return;
    }

    setRoleEditor({
      mode: "edit",
      roleId: role.id,
      name: role.name,
      llm: role.llm,
      model: role.model,
      channelIds: role.channelIds,
    });
  };

  const saveRoleEditor = () => {
    if (!roleEditor) {
      return;
    }

    const trimmedName = roleEditor.name.trim();

    if (!trimmedName) {
      return;
    }

    if (roleEditor.mode === "create") {
      const newRole = {
        id: createId("role"),
        name: trimmedName,
        title: toTitleCase(trimmedName),
        instructions: `Operate as the ${toTitleCase(trimmedName)} role.`,
        llm: roleEditor.llm,
        model: roleEditor.model,
        channelIds: roleEditor.channelIds,
      };

      onDraftChange({
        ...draft,
        roles: [...draft.roles, newRole],
        organizationReports: [
          ...draft.organizationReports,
          {
            id: createId("report"),
            subjectName: newRole.name,
            managerName: draft.roles.some((role) => role.name === "product-manager")
              ? "product-manager"
              : OWNER_MANAGER_SENTINEL,
          },
        ],
      });
      setRoleEditor(null);
      return;
    }

    const existingRole = draft.roles.find((role) => role.id === roleEditor.roleId);

    if (!existingRole) {
      return;
    }

    onDraftChange({
      ...draft,
      roles: draft.roles.map((role) =>
        role.id === roleEditor.roleId
          ? {
              ...role,
              name: trimmedName,
              title: toTitleCase(trimmedName),
              llm: roleEditor.llm,
              model: roleEditor.model,
              channelIds: roleEditor.channelIds,
            }
          : role,
      ),
      organizationReports: draft.organizationReports.map((report) => ({
        ...report,
        subjectName: report.subjectName === existingRole.name ? trimmedName : report.subjectName,
        managerName: report.managerName === existingRole.name ? trimmedName : report.managerName,
      })),
    });
    setRoleEditor(null);
  };

  const deleteRole = (roleId: string) => {
    const role = draft.roles.find((item) => item.id === roleId);

    if (!role) {
      return;
    }

    const shouldDelete = window.confirm(`Delete the role "${role.name}"?`);

    if (!shouldDelete) {
      return;
    }

    const fallbackManager =
      role.name === "product-manager"
        ? OWNER_MANAGER_SENTINEL
        : draft.roles.some((item) => item.name === "product-manager" && item.id !== roleId)
          ? "product-manager"
          : OWNER_MANAGER_SENTINEL;

    onDraftChange({
      ...draft,
      roles: draft.roles.filter((item) => item.id !== roleId),
      organizationReports: draft.organizationReports
        .filter((report) => report.subjectName !== role.name)
        .map((report) => ({
          ...report,
          managerName: report.managerName === role.name ? fallbackManager : report.managerName,
        })),
    });
    setRoleMenuId(null);
  };

  const openChannelEditor = (channelId?: string) => {
    if (!channelId) {
      setChannelEditor({ mode: "create", channelId: null, name: "", description: "" });
      return;
    }

    const channel = draft.channels.find((item) => item.id === channelId);

    if (!channel) {
      return;
    }

    setChannelEditor({
      mode: "edit",
      channelId: channel.id,
      name: channel.name,
      description: channel.description,
    });
  };

  const saveChannelEditor = () => {
    if (!channelEditor) {
      return;
    }

    const trimmedName = channelEditor.name.trim();
    const trimmedDescription = channelEditor.description.trim();

    if (!trimmedName || !trimmedDescription) {
      return;
    }

    if (channelEditor.mode === "create") {
      onDraftChange({
        ...draft,
        channels: [
          ...draft.channels,
          {
            id: createId("channel"),
            name: trimmedName,
            description: trimmedDescription,
          },
        ],
      });
      setChannelEditor(null);
      return;
    }

    onDraftChange({
      ...draft,
      channels: draft.channels.map((channel) =>
        channel.id === channelEditor.channelId
          ? { ...channel, name: trimmedName, description: trimmedDescription }
          : channel,
      ),
    });
    setChannelEditor(null);
  };

  const reportRows = draft.roles.map((role) => {
    const existingReport = draft.organizationReports.find((report) => report.subjectName === role.name);
    return (
      existingReport ?? {
        id: createId("report"),
        subjectName: role.name,
        managerName:
          role.name === "product-manager"
            ? OWNER_MANAGER_SENTINEL
            : draft.roles.some((item) => item.name === "product-manager")
              ? "product-manager"
              : OWNER_MANAGER_SENTINEL,
      }
    );
  });

  if (stepId === "organization") {
    return (
      <div className="rounded-[24px] border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Organization details</p>
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr),220px]">
          <div className="space-y-6">
            <FieldShell
              label="Organization name"
              htmlFor="organizationName"
              hint=""
              error={showError("organizationName") ? errors.organizationName : undefined}
            >
              <input
                id="organizationName"
                className={`w-full rounded-lg border bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 dark:bg-zinc-950 dark:text-zinc-100 ${
                  showError("organizationName")
                    ? "border-red-300 focus:border-red-500 dark:border-red-500/60"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
                value={draft.organizationName}
                onBlur={() => onFieldBlur("organizationName")}
                onChange={(event) => onDraftChange(updateField(draft, "organizationName", event.target.value))}
                placeholder="Acme Product Team"
                aria-invalid={showError("organizationName")}
              />
            </FieldShell>

            <FieldShell
              label="Workspace root"
              htmlFor="workspaceRoot"
              hint="Local path where the workspace will be created."
              error={showError("workspaceRoot") ? errors.workspaceRoot : undefined}
            >
              <div className="flex gap-3">
                <input
                  id="workspaceRoot"
                  className={`min-w-0 flex-1 rounded-lg border bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 dark:bg-zinc-950 dark:text-zinc-100 ${
                    showError("workspaceRoot")
                      ? "border-red-300 focus:border-red-500 dark:border-red-500/60"
                      : "border-zinc-200 dark:border-zinc-700"
                  }`}
                  value={draft.workspaceRoot}
                  onBlur={() => onFieldBlur("workspaceRoot")}
                  onChange={(event) => onDraftChange(updateField(draft, "workspaceRoot", event.target.value))}
                  placeholder="C:\\Users\\USER\\Desktop\\projects\\my-workspace"
                  aria-invalid={showError("workspaceRoot")}
                />
                <button
                  type="button"
                  onClick={onWorkspaceBrowse}
                  className="shrink-0 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Browse
                </button>
              </div>
              <input
                ref={directoryInputRef}
                type="file"
                className="hidden"
                onChange={onDirectoryInputChange}
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              />
              <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{folderPickerNote}</p>
            </FieldShell>
          </div>

          <OrganizationPreviewCard />
        </div>
      </div>
    );
  }

  if (stepId === "owner") {
    return (
      <div className="rounded-[24px] border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Owner details</p>
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr),220px]">
          <div className="space-y-6">
            <FieldShell
              label="Full name"
              htmlFor="ownerName"
              hint=""
              error={showError("ownerName") ? errors.ownerName : undefined}
            >
              <input
                id="ownerName"
                className={`w-full rounded-lg border bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 dark:bg-zinc-950 dark:text-zinc-100 ${
                  showError("ownerName")
                    ? "border-red-300 focus:border-red-500 dark:border-red-500/60"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
                value={draft.ownerName}
                onBlur={() => onFieldBlur("ownerName")}
                onChange={(event) => onDraftChange(updateField(draft, "ownerName", event.target.value))}
                placeholder="Alex Developer"
                aria-invalid={showError("ownerName")}
              />
            </FieldShell>

            <FieldShell
              label="Email"
              htmlFor="ownerEmail"
              hint="Used for the owner login after onboarding completes."
              error={showError("ownerEmail") ? errors.ownerEmail : undefined}
            >
              <input
                id="ownerEmail"
                type="email"
                className={`w-full rounded-lg border bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 dark:bg-zinc-950 dark:text-zinc-100 ${
                  showError("ownerEmail")
                    ? "border-red-300 focus:border-red-500 dark:border-red-500/60"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
                value={draft.ownerEmail}
                onBlur={() => onFieldBlur("ownerEmail")}
                onChange={(event) => onDraftChange(updateField(draft, "ownerEmail", event.target.value))}
                placeholder="alex@acme.com"
                aria-invalid={showError("ownerEmail")}
              />
            </FieldShell>

            <div>
              <FieldShell
                label="Password"
                htmlFor="ownerPassword"
                hint="Minimum 8 characters. This becomes the owner login password."
                error={showError("ownerPassword") ? errors.ownerPassword : undefined}
              >
                <div className="relative">
                  <input
                    id="ownerPassword"
                    type={showOwnerPassword ? "text" : "password"}
                    className={`w-full rounded-lg border bg-white px-4 py-2.5 pr-11 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 dark:bg-zinc-950 dark:text-zinc-100 ${
                      showError("ownerPassword")
                        ? "border-red-300 focus:border-red-500 dark:border-red-500/60"
                        : "border-zinc-200 dark:border-zinc-700"
                    }`}
                    value={draft.ownerPassword}
                    onBlur={() => onFieldBlur("ownerPassword")}
                    onChange={(event) => onDraftChange(updateField(draft, "ownerPassword", event.target.value))}
                    placeholder="••••••••"
                    aria-invalid={showError("ownerPassword")}
                  />
                  <button
                    type="button"
                    onClick={onToggleOwnerPassword}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"
                    aria-label={showOwnerPassword ? "Hide password" : "Show password"}
                  >
                    {showOwnerPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FieldShell>
              <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                You&apos;ll be the owner and have full access to the organization.
              </p>
            </div>
          </div>

          <OwnerPreviewCard />
        </div>
      </div>
    );
  }

  if (stepId === "team") {
    return (
      <div className="space-y-6">
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex flex-wrap gap-6">
            {TEAM_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTeamTab;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTeamTabChange(tab.id)}
                  className={`inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition ${
                    isActive
                      ? "border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300"
                      : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeTeamTab === "agents" ? (
          <TeamConfigCard title="Roles (agents)" description="Define the roles and capabilities in your team.">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Manage the default roles, update their LLM and model, and decide which channels each role should use.
                </p>
                <button
                  type="button"
                  onClick={() => openRoleEditor()}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
                >
                  <Plus className="h-4 w-4" />
                  Add role
                </button>
              </div>

              <div className="space-y-4">
                {draft.roles.map((role) => (
                  <article key={role.id} className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-xs font-semibold text-white">
                          {role.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{role.name}</p>
                            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                              {role.title}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{role.instructions}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                            <span className="inline-flex items-center gap-1.5">
                              <Bot className="h-3.5 w-3.5" />
                              {role.model}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Server className="h-3.5 w-3.5" />
                              {role.llm}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5" />
                              {role.channelIds.length} channels
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                              Active
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setRoleMenuId((current) => (current === role.id ? null : role.id))}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                          aria-label={`Open actions for ${role.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {roleMenuId === role.id ? (
                          <div className="absolute right-0 top-11 z-20 w-40 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                            <button
                              type="button"
                              onClick={() => {
                                openRoleEditor(role.id);
                                setRoleMenuId(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                            >
                              <PencilLine className="h-4 w-4" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteRole(role.id)}
                              className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </TeamConfigCard>
        ) : null}

        {activeTeamTab === "channels" ? (
          <TeamConfigCard title="Channels" description="Create channels and edit the default ones used by your roles.">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Channels can be edited to change their name and purpose. Newly added channels become available in role configuration.</p>
                <button
                  type="button"
                  onClick={() => openChannelEditor()}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
                >
                  <Plus className="h-4 w-4" />
                  Add channel
                </button>
              </div>

              <div className="space-y-3">
                {draft.channels.map((channel) => (
                  <div key={channel.id} className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 px-4 py-4 dark:border-zinc-800">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 text-zinc-400">
                        <Hash className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{channel.name}</p>
                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{channel.description}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openChannelEditor(channel.id)}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      <PencilLine className="h-4 w-4" />
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </TeamConfigCard>
        ) : null}

        {activeTeamTab === "org-chart" ? (
          <TeamConfigCard title="Organization chart" description="Order the reporting structure from agent or role on the left to senior on the right.">
            <div className="space-y-3">
              {reportRows.map((report) => (
                <div key={report.id} className="flex flex-nowrap items-center gap-3">
                  <div className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
                    {report.subjectName}
                  </div>
                  <div className="flex w-10 shrink-0 items-center justify-center text-sm text-zinc-400">→</div>
                  <select
                    value={report.managerName}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        organizationReports: reportRows.map((item) =>
                          item.id === report.id ? { ...item, managerName: event.target.value } : item,
                        ),
                      })
                    }
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    {[
                      // Role refs use the role name as both value and label.
                      ...draft.roles.map((role) => ({ value: role.name, label: role.name })),
                      // Owner ref persists the stable sentinel so a later
                      // owner rename keeps existing edges intact; the
                      // dropdown still renders the current friendly label.
                      { value: OWNER_MANAGER_SENTINEL, label: ownerLabel },
                    ]
                      .filter((option) => option.value !== report.subjectName)
                      .map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                </div>
              ))}
            </div>
          </TeamConfigCard>
        ) : null}

        {activeTeamTab === "policies" ? (
          <TeamConfigCard title="Policies" description="Configure the default approval and execution policies for the team.">
            <div className="space-y-4">
              <label className="flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-4 dark:border-zinc-800">
                <span>
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Require approval for writes</span>
                  <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">Agent write operations must be approved before execution.</span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.policies.requireApprovalForWrites}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      policies: { ...draft.policies, requireApprovalForWrites: event.target.checked },
                    })
                  }
                  className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-4 dark:border-zinc-800">
                <span>
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Require approval for shell</span>
                  <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">Shell execution must be reviewed before commands run.</span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.policies.requireApprovalForShell}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      policies: { ...draft.policies, requireApprovalForShell: event.target.checked },
                    })
                  }
                  className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                />
              </label>
            </div>
          </TeamConfigCard>
        ) : null}

        {activeTeamTab === "providers" ? (
          <TeamConfigCard title="Providers" description="These values are submitted as providerKeys to the API, so enter real provider names and API keys.">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Configure provider names and live API keys used by your team roles.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    onDraftChange({
                      ...draft,
                      providers: [...draft.providers, { id: createId("provider"), name: "", apiKey: "" }],
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
                >
                  <Plus className="h-4 w-4" />
                  Add provider
                </button>
              </div>

              <div className="space-y-3">
                {draft.providers.map((provider, index) => (
                  <div key={provider.id} className="flex flex-nowrap items-center gap-3">
                    <input
                      value={provider.name}
                      onChange={(event) =>
                        onDraftChange({
                          ...draft,
                          providers: draft.providers.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: event.target.value } : item,
                          ),
                        })
                      }
                      className="w-[220px] shrink-0 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
                      placeholder="openai"
                    />
                    <input
                      type="password"
                      value={provider.apiKey}
                      onChange={(event) =>
                        onDraftChange({
                          ...draft,
                          providers: draft.providers.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, apiKey: event.target.value } : item,
                          ),
                        })
                      }
                      className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
                      placeholder={provider.name ? `${formatProviderLabel(provider.name)} API key` : "Provider API key"}
                    />
                  </div>
                ))}
              </div>
            </div>
          </TeamConfigCard>
        ) : null}

        {roleEditor ? (
          <ModalShell
            title={roleEditor.mode === "create" ? "Add role" : "Edit role"}
            description="Update the role name, LLM, model, and channel access."
            onClose={() => setRoleEditor(null)}
          >
            <div className="space-y-5">
              <FieldShell label="Role name" htmlFor="roleName" hint="">
                <input
                  id="roleName"
                  value={roleEditor.name}
                  onChange={(event) => setRoleEditor({ ...roleEditor, name: event.target.value })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
                  placeholder="senior-engineer"
                />
              </FieldShell>

              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="LLM provider" htmlFor="roleLlm" hint="">
                  <select
                    id="roleLlm"
                    value={roleEditor.llm}
                    onChange={(event) => setRoleEditor({ ...roleEditor, llm: event.target.value })}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    {LLM_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </FieldShell>
                <FieldShell label="Model" htmlFor="roleModel" hint="">
                  <input
                    id="roleModel"
                    value={roleEditor.model}
                    onChange={(event) => setRoleEditor({ ...roleEditor, model: event.target.value })}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
                    placeholder="claude-3-5-sonnet"
                  />
                </FieldShell>
              </div>

              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Channels</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {draft.channels.map((channel) => (
                    <label key={channel.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
                      <input
                        type="checkbox"
                        checked={roleEditor.channelIds.includes(channel.id)}
                        onChange={(event) =>
                          setRoleEditor({
                            ...roleEditor,
                            channelIds: event.target.checked
                              ? [...roleEditor.channelIds, channel.id]
                              : roleEditor.channelIds.filter((item) => item !== channel.id),
                          })
                        }
                        className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span className="text-zinc-700 dark:text-zinc-200">{channel.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRoleEditor(null)}
                  className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveRoleEditor}
                  className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700"
                >
                  Save role
                </button>
              </div>
            </div>
          </ModalShell>
        ) : null}

        {channelEditor ? (
          <ModalShell
            title={channelEditor.mode === "create" ? "Add channel" : "Edit channel"}
            description="Update the channel name and description."
            onClose={() => setChannelEditor(null)}
          >
            <div className="space-y-5">
              <FieldShell label="Channel name" htmlFor="channelName" hint="">
                <input
                  id="channelName"
                  value={channelEditor.name}
                  onChange={(event) => setChannelEditor({ ...channelEditor, name: event.target.value })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
                  placeholder="general"
                />
              </FieldShell>
              <FieldShell label="Description" htmlFor="channelDescription" hint="">
                <textarea
                  id="channelDescription"
                  value={channelEditor.description}
                  onChange={(event) => setChannelEditor({ ...channelEditor, description: event.target.value })}
                  className="min-h-24 w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
                  placeholder="General discussions and updates"
                />
              </FieldShell>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setChannelEditor(null)}
                  className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveChannelEditor}
                  className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700"
                >
                  Save channel
                </button>
              </div>
            </div>
          </ModalShell>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.15fr,1.1fr,1.25fr]">
        <ReviewSection title="Organization">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{draft.organizationName || "Acme Product Team"}</p>
          <p className="mt-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Root: {draft.workspaceRoot || "/Users/admin/ujima/acme-product"}
          </p>
        </ReviewSection>

        <ReviewSection title="Team summary">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300">
              <span className="inline-flex items-center gap-2">
                <Users className="h-4 w-4 text-zinc-400" />
                Agents
              </span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{draft.organizationReports.length}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300">
              <span className="inline-flex items-center gap-2">
                <Bot className="h-4 w-4 text-zinc-400" />
                Roles
              </span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{draft.roles.length}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300">
              <span className="inline-flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-zinc-400" />
                Channels
              </span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{draft.channels.length}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-zinc-400" />
                Policies
              </span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">2</span>
            </div>
          </div>
        </ReviewSection>

        <ReviewSection title="Workspace boundary">
          <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            Hard boundary
          </span>
          <ul className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
              <span>File system access limited to workspace</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
              <span>Shell execution requires approval</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
              <span>Network access restricted</span>
            </li>
          </ul>
        </ReviewSection>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ReviewSection title={`Roles (${draft.roles.length})`}>
          <div className="space-y-4">
            {draft.roles.map((role, index) => (
              <div key={`${role.name}-${index}`} className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-[11px] font-semibold text-white">
                  {role.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{role.name}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{role.title}</p>
                </div>
              </div>
            ))}
          </div>
        </ReviewSection>

        <ReviewSection title={`Channels (${draft.channels.length})`}>
          <div className="space-y-4">
            {draft.channels.map((channel, index) => (
              <div key={`${channel.id}-${index}`} className="flex items-start gap-3">
                <div className="mt-0.5 text-zinc-400">
                  <Hash className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{channel.name}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{channel.description}</p>
                </div>
              </div>
            ))}
          </div>
        </ReviewSection>

        <ReviewSection title="Policies">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Require approval for writes</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {draft.policies.requireApprovalForWrites ? "On" : "Off"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Require approval for shell</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {draft.policies.requireApprovalForShell ? "On" : "Off"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Providers</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{draft.providers.length} configured</span>
            </div>
          </div>
        </ReviewSection>
      </div>
    </div>
  );
}

export function OnboardingForm({
  step,
  stepIndex,
  totalSteps,
  draft,
  onDraftChange,
  activeTeamTab,
  onTeamTabChange,
  onBack,
  onNext,
  onSubmit,
  canGoBack,
  isLastStep,
  isSubmitting,
  submitError,
}: OnboardingFormProps) {
  const [touchedFields, setTouchedFields] = useState<Partial<Record<DraftField, boolean>>>({});
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const directoryInputRef = useRef<HTMLInputElement>(null);

  const stepMeta = {
    organization: {
      icon: FolderKanban,
      eyebrow: "Workspace foundation",
      note: "Let's start with the basics. This will be used to create your organization and workspace.",
    },
    owner: {
      icon: ShieldCheck,
      eyebrow: "Access setup",
      note: "Create the first trusted operator for the workspace.",
    },
    team: {
      icon: Users,
      eyebrow: "Operating model",
      note: "Choose the starting team shape for collaboration.",
    },
    review: {
      icon: Sparkles,
      eyebrow: "Final confirmation",
      note: "Review your configuration before initializing your organization and workspace.",
    },
  }[step.id];

  const stepErrors = useMemo(() => validateStep(step.id, draft, activeTeamTab), [activeTeamTab, draft, step.id]);
  const isStepValid = Object.keys(stepErrors).length === 0;
  const validationMessage = getValidationMessage(step.id, stepErrors);
  const folderPickerNote =
    "Browse to choose a folder from your computer. Some browsers only expose the folder name, so you can still paste the full path manually if needed.";
  const activeTeamTabIndex = TEAM_TABS.findIndex((tab) => tab.id === activeTeamTab);
  const nextLabel =
    step.id === "team"
      ? activeTeamTabIndex < TEAM_TABS.length - 1
        ? TEAM_TABS[activeTeamTabIndex + 1].label
        : "Review & create"
      : stepIndex + 2 <= totalSteps
        ? ONBOARDING_STEP_NEXT_LABELS[step.id]
        : "Complete";

  const markFieldTouched = (field: DraftField) => {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  };

  const shouldShowError = (field: DraftField) => Boolean(stepErrors[field] && (attemptedSubmit || touchedFields[field]));

  const handleContinue = () => {
    setAttemptedSubmit(true);

    if (!isStepValid) {
      return;
    }

    if (isLastStep) {
      void onSubmit(draft);
      return;
    }

    onNext();
  };

  const handleWorkspaceBrowse = async () => {
    markFieldTouched("workspaceRoot");

    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      const picker = (
        window as Window & {
          showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker;

      if (picker) {
        try {
          const selectedDirectory = await picker();
          onDraftChange(updateField(draft, "workspaceRoot", selectedDirectory.name));
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      }
    }

    directoryInputRef.current?.click();
  };

  const handleDirectoryInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const [firstFile] = Array.from(event.target.files ?? []);

    if (!firstFile) {
      return;
    }

    const relativePath = (firstFile as File & { webkitRelativePath?: string }).webkitRelativePath;
    const folderName = relativePath?.split("/")[0];

    if (folderName) {
      onDraftChange(updateField(draft, "workspaceRoot", folderName));
    }

    event.target.value = "";
  };

  return (
    <section className="bg-white px-6 py-6 dark:bg-zinc-950 md:px-8 md:py-7">
      <div>
        <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">{step.title}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{stepMeta.note}</p>
      </div>

      <div className="mt-8">
        <StepFields
          stepId={step.id}
          draft={draft}
          onDraftChange={onDraftChange}
          errors={stepErrors}
          showError={shouldShowError}
          onFieldBlur={markFieldTouched}
          onWorkspaceBrowse={handleWorkspaceBrowse}
          directoryInputRef={directoryInputRef}
          onDirectoryInputChange={handleDirectoryInputChange}
          folderPickerNote={folderPickerNote}
          showOwnerPassword={showOwnerPassword}
          onToggleOwnerPassword={() => setShowOwnerPassword((current) => !current)}
          activeTeamTab={activeTeamTab}
          onTeamTabChange={onTeamTabChange}
        />

        {isLastStep ? (
          <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <button
              type="button"
              onClick={onBack}
              disabled={!canGoBack || isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={handleContinue}
              disabled={!isStepValid || isSubmitting}
              aria-disabled={!isStepValid || isSubmitting}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition ${
                isStepValid
                  ? "bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 disabled:hover:bg-violet-400"
                  : "bg-violet-300 hover:bg-violet-300 dark:bg-violet-500/50 dark:hover:bg-violet-500/50"
              }`}
            >
              {isSubmitting ? "Creating organization..." : "Create organization"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleContinue}
              disabled={!isStepValid || isSubmitting}
              aria-disabled={!isStepValid || isSubmitting}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition ${
                isStepValid
                  ? "bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 disabled:hover:bg-violet-400"
                  : "bg-violet-300 hover:bg-violet-300 dark:bg-violet-500/50 dark:hover:bg-violet-500/50"
              }`}
            >
              {isSubmitting ? "Working..." : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </button>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Next: <span className="font-medium text-zinc-700 dark:text-zinc-200">{nextLabel}</span>
            </p>
          </div>
        )}
        {attemptedSubmit && !isStepValid && validationMessage ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400" role="alert">
            <AlertCircle className="h-4 w-4" />
            {validationMessage}
          </p>
        ) : null}
        {submitError ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400" role="alert">
            <AlertCircle className="h-4 w-4" />
            {submitError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
