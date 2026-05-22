"use client";
import { useMemo, useState } from "react";
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
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { MIN_TEAM_AGENTS } from "../api-contract";
import { getSuggestedAgentName } from "../agent-name-suggestions";
import { Avatar } from "../../workspace/components/chat/primitives";
import { Select } from "@/components/ui/select";
import { FieldShell, TextInput } from "@/components/ui/form-fields";
import { ChannelFormFields } from "@/features/team/channel-form-fields";
import { normalizeChannelName } from "@/features/team/channel-form-fields";
import { OrgChartFields } from "@/features/team/org-chart-fields";
import { RoleFormFields } from "@/features/team/role-form-fields";
import {
  OWNER_MANAGER_SENTINEL,
  defaultModelForProvider,
  type OnboardingDraft,
  type OnboardingStep,
  type OnboardingStepId,
  type RolePresetTemplate,
  type TeamTabId,
} from "../types";
import { PROVIDER_OPTIONS } from "@/features/providers/catalog";
import { ProviderCredentialField } from "@/features/providers/provider-credential-field";
import { PolicyApprovalFields } from "@/features/providers/policy-approval-fields";

interface OnboardingFormProps {
  step: OnboardingStep;
  stepIndex: number;
  totalSteps: number;
  draft: OnboardingDraft;
  suggestedRoles: RolePresetTemplate[];
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
      errors.organizationName = "Enter a workspace name.";
    }

    if (!draft.workspaceRoot.trim()) {
      errors.workspaceRoot = "Choose or enter a project folder.";
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
    <div className="flex flex-col sm:flex-row sm:items-center gap-5 rounded-2xl bg-violet-50 p-6 dark:bg-violet-500/10">
      <div className="flex shrink-0 h-11 w-11 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-zinc-900 dark:text-violet-300">
        <FolderKanban className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Workspace boundary</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          All agents will operate within the configured workspace boundary for maximum safety.
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 inline-flex items-center gap-2 text-sm font-medium text-violet-700 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
      >
        Learn more
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function OwnerPreviewCard() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-5 rounded-2xl bg-violet-50 p-6 dark:bg-violet-500/10">
      <div className="flex shrink-0 h-11 w-11 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-zinc-900 dark:text-violet-300">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Owner permissions</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          The onboarding API currently creates the first owner from the full name field and stores the person as the initial human member.
        </p>
      </div>
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

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getRoleTemplate(templateName: string, suggestedRoles: RolePresetTemplate[]) {
  return suggestedRoles.find((template) => template.name === templateName);
}

function getGeneralChannelIds(draft: OnboardingDraft) {
  return [draft.channels.find((channel) => channel.name === "general")?.id ?? draft.channels[0]?.id].filter(
    (channelId): channelId is string => Boolean(channelId),
  );
}

function getNextSuggestedTemplate(suggestedRoles: RolePresetTemplate[], draft: OnboardingDraft) {
  return suggestedRoles.find((template) => !draft.roles.some((role) => role.name === template.name)) ?? suggestedRoles[0];
}

function matchesSuggestedRole(template: RolePresetTemplate, query: string) {
  const haystack = `${template.title} ${template.name} ${template.description} ${template.instructions} ${template.channels.join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

function formatIndustryLabel(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function validateTeamTab(tabId: TeamTabId, draft: OnboardingDraft): string | null {
  if (draft.roles.length < MIN_TEAM_AGENTS) {
    return `Add at least ${MIN_TEAM_AGENTS} agents before continuing.`;
  }

  if (tabId === "agents") {
    const agentNames = new Set<string>();
    const hasValidRoles = draft.roles.every((role) => {
      const roleName = role.name.trim();
      const agentName = role.agentName.trim();

      if (!roleName || !agentName || !role.llm.trim() || role.channelIds.length === 0 || agentNames.has(agentName)) {
        return false;
      }

      agentNames.add(agentName);
      return true;
    });

    if (!hasValidRoles || draft.roles.length === 0) {
      return `Complete at least ${MIN_TEAM_AGENTS} agents with names, role templates, provider, and channel setup before continuing.`;
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
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-[24px] border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
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
  suggestedRoles,
  onDraftChange,
  errors,
  showError,
  onFieldBlur,
  showOwnerPassword,
  onToggleOwnerPassword,
  activeTeamTab,
  onTeamTabChange,
}: {
  stepId: OnboardingStepId;
  draft: OnboardingDraft;
  suggestedRoles: RolePresetTemplate[];
  onDraftChange: (next: OnboardingDraft) => void;
  errors: DraftErrors;
  showError: (field: DraftField) => boolean;
  onFieldBlur: (field: DraftField) => void;
  showOwnerPassword: boolean;
  onToggleOwnerPassword: () => void;
  activeTeamTab: TeamTabId;
  onTeamTabChange: (tabId: TeamTabId) => void;
}) {
  const [roleMenuId, setRoleMenuId] = useState<string | null>(null);
  const [isPickingWorkspaceRoot, setIsPickingWorkspaceRoot] = useState(false);
  const [workspaceRootPickError, setWorkspaceRootPickError] = useState<string | null>(null);
  const [roleEditor, setRoleEditor] = useState<{
    mode: "create" | "edit";
    roleId: string | null;
    templateName: string;
    name: string;
    agentName: string;
    title: string;
    instructions: string;
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
  const [roleSearch, setRoleSearch] = useState("");
  const [activeRoleIndustry, setActiveRoleIndustry] = useState("all");

  const pickWorkspaceRoot = async () => {
    setWorkspaceRootPickError(null);
    setIsPickingWorkspaceRoot(true);
    try {
      const response = await fetch("/api/onboarding/pick-workspace-root", { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { path?: string; cancelled?: boolean; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(body?.message ?? "Unable to open folder picker.");
      }

      if (body?.path) {
        onDraftChange(updateField(draft, "workspaceRoot", body.path));
      }
    } catch (error) {
      setWorkspaceRootPickError(
        error instanceof Error ? error.message : "Unable to open folder picker.",
      );
    } finally {
      setIsPickingWorkspaceRoot(false);
    }
  };

  const ownerLabel = draft.ownerName.trim() || "Owner";
  const starterRoleTemplates: RolePresetTemplate[] =
    suggestedRoles.length > 0
      ? suggestedRoles
      : draft.roles.map((role) => ({
          name: role.name,
          title: role.title,
          description: role.instructions,
          instructions: role.instructions,
          channels: draft.channels
            .filter((channel) => role.channelIds.includes(channel.id))
            .map((channel) => channel.name),
          industry: "general",
          key: role.name,
        }));
  const roleIndustries = useMemo(() => {
    const ordered = new Map<string, RolePresetTemplate[]>();

    for (const template of starterRoleTemplates) {
      const industry = template.industry || "general";
      const bucket = ordered.get(industry);

      if (bucket) {
        bucket.push(template);
      } else {
        ordered.set(industry, [template]);
      }
    }

    return Array.from(ordered.entries())
      .filter(([industry]) => industry !== "general")
      .map(([industry, templates]) => ({ industry, templates }));
  }, [starterRoleTemplates]);
  const resolvedActiveRoleIndustry =
    activeRoleIndustry === "all" || roleIndustries.some((group) => group.industry === activeRoleIndustry)
      ? activeRoleIndustry
      : roleIndustries[0]?.industry ?? "all";
  const defaultSuggestedTemplate = getNextSuggestedTemplate(starterRoleTemplates, draft);
  const filteredSuggestedRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    const byIndustry =
      resolvedActiveRoleIndustry === "all"
        ? starterRoleTemplates
        : starterRoleTemplates.filter((template) => template.industry === resolvedActiveRoleIndustry);

    if (!query) {
      return byIndustry;
    }

    return byIndustry.filter((template) => matchesSuggestedRole(template, query));
  }, [resolvedActiveRoleIndustry, roleSearch, starterRoleTemplates]);

  const openRoleEditor = (roleId?: string, templateName?: string) => {
    if (!roleId) {
    const defaultProvider = draft.providers[0]?.name || "openai";
      const template = getRoleTemplate(templateName ?? defaultSuggestedTemplate?.name ?? starterRoleTemplates[0]?.name ?? "", starterRoleTemplates);

      if (!template) {
        return;
      }

      setRoleEditor({
        mode: "create",
        roleId: null,
        templateName: template.name,
        name: template.name,
        agentName: getSuggestedAgentName(),
        title: template.title,
        instructions: template.instructions,
        llm: defaultProvider,
        model: defaultModelForProvider(defaultProvider),
        channelIds: getGeneralChannelIds(draft),
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
      templateName: getRoleTemplate(role.name, starterRoleTemplates)?.name ?? role.name,
      name: role.name,
      agentName: role.agentName,
      title: role.title,
      instructions: role.instructions,
      llm: role.llm,
      model: role.model,
      channelIds: role.channelIds,
    });
  };

  const updateRoleEditorTemplate = (templateName: string) => {
    const template = getRoleTemplate(templateName, starterRoleTemplates);

    if (!template) {
      return;
    }

    setRoleEditor((current) =>
      current
        ? {
            ...current,
            templateName: template.name,
            name: template.name,
            title: template.title,
            instructions: template.instructions,
            channelIds: current.channelIds,
            agentName: current.agentName || template.title,
          }
        : current,
    );
  };

  const saveRoleEditor = () => {
    if (!roleEditor) {
      return;
    }

    const trimmedName = roleEditor.name.trim();
    const trimmedAgentName = roleEditor.agentName.trim();

    if (!trimmedName || !trimmedAgentName || roleEditor.channelIds.length === 0) {
      return;
    }

    if (roleEditor.mode === "create") {
      const newRole = {
        id: createId("role"),
        name: trimmedName,
        agentName: trimmedAgentName,
        title: roleEditor.title,
        instructions: roleEditor.instructions,
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
            subjectName: newRole.agentName,
            managerName:
              draft.roles.find((role) => role.name === "engineering-manager")?.agentName.trim() ||
              draft.roles.find((role) => role.name === "pm")?.agentName.trim() ||
              draft.roles.find((role) => role.name === "product-manager")?.agentName.trim() ||
              OWNER_MANAGER_SENTINEL,
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
              agentName: trimmedAgentName,
              title: roleEditor.title,
              instructions: roleEditor.instructions,
              llm: roleEditor.llm,
              model: roleEditor.model,
              channelIds: roleEditor.channelIds,
            }
          : role,
      ),
      organizationReports: draft.organizationReports.map((report) => ({
        ...report,
        subjectName: report.subjectName === existingRole.agentName ? trimmedAgentName : report.subjectName,
        managerName: report.managerName === existingRole.agentName ? trimmedAgentName : report.managerName,
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
      role.name === "engineering-manager" || role.name === "pm" || role.name === "product-manager"
        ? OWNER_MANAGER_SENTINEL
        : draft.roles.find((item) => item.name === "engineering-manager" && item.id !== roleId)?.agentName.trim() ||
          draft.roles.find((item) => item.name === "pm" && item.id !== roleId)?.agentName.trim() ||
          draft.roles.find((item) => item.name === "product-manager" && item.id !== roleId)?.agentName.trim() ||
          OWNER_MANAGER_SENTINEL;

    onDraftChange({
      ...draft,
      roles: draft.roles.filter((item) => item.id !== roleId),
      organizationReports: draft.organizationReports
        .filter((report) => report.subjectName !== role.agentName)
        .map((report) => ({
          ...report,
          managerName: report.managerName === role.agentName ? fallbackManager : report.managerName,
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

    const trimmedName = normalizeChannelName(channelEditor.name, channelEditor.mode);
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
    const existingReport = draft.organizationReports.find((report) => report.subjectName === role.agentName);
    return (
      existingReport ?? {
        id: createId("report"),
        subjectName: role.agentName,
        managerName:
          role.name === "engineering-manager" || role.name === "pm" || role.name === "product-manager"
            ? OWNER_MANAGER_SENTINEL
            : draft.roles.find((item) => item.name === "engineering-manager")?.agentName.trim() ||
              draft.roles.find((item) => item.name === "pm")?.agentName.trim() ||
              draft.roles.find((item) => item.name === "product-manager")?.agentName.trim() ||
              OWNER_MANAGER_SENTINEL,
      }
    );
  });

  if (stepId === "organization") {
    return (
      <div className="rounded-[24px] border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-8">
          <div className="space-y-6">
            <FieldShell
              label="Workspace name"
              htmlFor="organizationName"
              hint=""
              error={showError("organizationName") ? errors.organizationName : undefined}
            >
              <TextInput
                id="organizationName"
                error={showError("organizationName")}
                value={draft.organizationName}
                onBlur={() => onFieldBlur("organizationName")}
                onChange={(event) => onDraftChange(updateField(draft, "organizationName", event.target.value))}
                placeholder="Acme Product Team"
                aria-invalid={showError("organizationName")}
              />
            </FieldShell>

            <FieldShell
              label="Project folder"
              htmlFor="workspaceRoot"
              hint="Browse opens a native folder dialog when this app runs on your machine (local dev). Hosted installs: type an absolute path."
              error={showError("workspaceRoot") ? errors.workspaceRoot : undefined}
            >
              <div className="flex gap-2">
                <TextInput
                  id="workspaceRoot"
                  error={showError("workspaceRoot")}
                  value={draft.workspaceRoot}
                  onBlur={() => onFieldBlur("workspaceRoot")}
                  onChange={(event) => onDraftChange(updateField(draft, "workspaceRoot", event.target.value))}
                  placeholder="/absolute/path/to/your-workspace"
                  aria-invalid={showError("workspaceRoot")}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => void pickWorkspaceRoot()}
                  disabled={isPickingWorkspaceRoot}
                  className="rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  {isPickingWorkspaceRoot ? "Opening..." : "Browse"}
                </button>
              </div>
              {workspaceRootPickError ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{workspaceRootPickError}</p>
              ) : null}
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
        <div className="mt-6 flex flex-col gap-8">
          <div className="space-y-6">
            <FieldShell
              label="Full name"
              htmlFor="ownerName"
              hint=""
              error={showError("ownerName") ? errors.ownerName : undefined}
            >
              <TextInput
                id="ownerName"
                error={showError("ownerName")}
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
              <TextInput
                id="ownerEmail"
                type="email"
                error={showError("ownerEmail")}
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
                  <TextInput
                    id="ownerPassword"
                    type={showOwnerPassword ? "text" : "password"}
                    error={showError("ownerPassword")}
                    className="pr-11"
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
          <TeamConfigCard
            title="Suggested roles"
            description={`Choose a starting role and add at least ${MIN_TEAM_AGENTS} agents.`}
            actions={
              <button
                type="button"
                onClick={() => openRoleEditor()}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
              >
                <Plus className="h-4 w-4" />
                Add role
              </button>
            }
          >
            <div className="space-y-4">
              <div className="rounded-[28px] border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/30">
                <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/95 px-4 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
                  <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onClick={() => setActiveRoleIndustry("all")}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        activeRoleIndustry === "all"
                          ? "border-violet-600 bg-violet-600 text-white"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      }`}
                    >
                      All
                    </button>
                    {roleIndustries.map((group) => {
                      const isActive = group.industry === activeRoleIndustry;

                      return (
                        <button
                          key={group.industry}
                          type="button"
                          onClick={() => setActiveRoleIndustry(group.industry)}
                          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            isActive
                              ? "border-violet-600 bg-violet-600 text-white"
                              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                          }`}
                        >
                          {formatIndustryLabel(group.industry)}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      <TextInput
                        value={roleSearch}
                        onChange={(event) => setRoleSearch(event.target.value)}
                        placeholder="Search roles, channels, or descriptions"
                        className="pl-9 pr-3"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setRoleSearch("")}
                      className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span>
                      Showing {filteredSuggestedRoles.length} of {starterRoleTemplates.length} suggested roles
                    </span>
                  </div>
                </div>

                <div className="max-h-[420px] overflow-y-auto px-4 py-4">
                  {filteredSuggestedRoles.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {filteredSuggestedRoles.map((template) => (
                        <button
                          key={template.name}
                          type="button"
                          onClick={() => openRoleEditor(undefined, template.name)}
                          className="rounded-2xl border border-zinc-200 bg-white p-4 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{template.title}</p>
                              <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{template.description}</p>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                              {formatIndustryLabel(template.industry)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No suggested roles match</p>
                        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Try a different search or clear the filter to browse the full catalog.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {draft.roles.map((role, index) => (
                  <article key={role.id} className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 gap-4">
                        <Avatar name={role.agentName} colorIndex={index} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{role.agentName}</p>
                            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                              {role.title}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Role template: {role.name}</p>
                          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            {role.instructions.length > 150 ? `${role.instructions.slice(0, 150).trim()}...` : role.instructions}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {role.channelIds.map((channelId) => {
                              const channelName = draft.channels.find((channel) => channel.id === channelId)?.name;

                              if (!channelName) {
                                return null;
                              }

                              return (
                                <span
                                  key={`${role.id}-${channelId}`}
                                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                                >
                                  {channelName}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setRoleMenuId((current) => (current === role.id ? null : role.id))}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                          aria-label={`Open actions for ${role.agentName}`}
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
            <OrgChartFields
              rows={reportRows.map((report) => ({
                key: report.id,
                subjectLabel: report.subjectName,
                managerValue: report.managerName,
                managerOptions: [
                  ...draft.roles.map((role) => ({
                    value: role.agentName,
                    label: `${role.agentName} (${role.name})`,
                  })),
                  { value: OWNER_MANAGER_SENTINEL, label: ownerLabel },
                ].filter((option) => option.value !== report.subjectName),
              }))}
              onManagerChange={(reportId, managerName) =>
                onDraftChange({
                  ...draft,
                  organizationReports: reportRows.map((item) =>
                    item.id === reportId ? { ...item, managerName } : item,
                  ),
                })
              }
            />
          </TeamConfigCard>
        ) : null}

        {activeTeamTab === "policies" ? (
          <TeamConfigCard title="Policies" description="Configure the default approval and execution policies for the team.">
            <PolicyApprovalFields
              variant="checkbox"
              values={{
                requireApprovalForWrites: draft.policies.requireApprovalForWrites,
                requireApprovalForShell: draft.policies.requireApprovalForShell,
              }}
              onChange={(key, value) =>
                onDraftChange({
                  ...draft,
                  policies: { ...draft.policies, [key]: value },
                })
              }
            />
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
                    <Select
                      value={provider.name}
                      onChange={(event) => {
                        const newName = event.target.value;
                        const isFirst = index === 0;

                        const newProviders = draft.providers.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: newName } : item,
                        );

                        let newRoles = draft.roles;
                        if (isFirst) {
                          const model = defaultModelForProvider(newName);
                          newRoles = draft.roles.map((role) => ({ ...role, llm: newName, model }));
                        }

                        onDraftChange({
                          ...draft,
                          providers: newProviders,
                          roles: newRoles,
                        });
                      }}
                      className="w-[220px] shrink-0"
                      placeholder="Select provider"
                      options={PROVIDER_OPTIONS.map((opt) => ({ value: opt.token, label: opt.label }))}
                    />
                    <ProviderCredentialField
                      provider={provider.name}
                      apiKey={provider.apiKey}
                      onApiKeyChange={(apiKey) =>
                        onDraftChange({
                          ...draft,
                          providers: draft.providers.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, apiKey } : item,
                          ),
                        })
                      }
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
            description="Choose a suggested role, add an agent name, then pick provider, model, and channels."
            onClose={() => setRoleEditor(null)}
          >
            <div className="space-y-5">
              <RoleFormFields
                templateName={roleEditor.templateName}
                templateOptions={starterRoleTemplates}
                onTemplateChange={updateRoleEditorTemplate}
                agentName={roleEditor.agentName}
                onAgentNameChange={(agentName) =>
                  setRoleEditor((current) => (current ? { ...current, agentName } : current))
                }
                title={roleEditor.title}
                onTitleChange={(title) =>
                  setRoleEditor((current) => (current ? { ...current, title } : current))
                }
                instructions={roleEditor.instructions}
                onInstructionsChange={(instructions) =>
                  setRoleEditor((current) => (current ? { ...current, instructions } : current))
                }
                llm={roleEditor.llm}
                model={roleEditor.model}
                onLlmChange={(llm) =>
                  setRoleEditor((current) => (current ? { ...current, llm } : current))
                }
                onModelChange={(model) =>
                  setRoleEditor((current) => (current ? { ...current, model } : current))
                }
                channelIds={roleEditor.channelIds}
                onChannelIdsChange={(channelIds) =>
                  setRoleEditor((current) => (current ? { ...current, channelIds } : current))
                }
                channels={draft.channels.map((channel) => ({ id: channel.id, name: channel.name }))}
              />

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
              <ChannelFormFields
                mode={channelEditor.mode}
                name={channelEditor.name}
                description={channelEditor.description}
                onNameChange={(name) => setChannelEditor({ ...channelEditor, name })}
                onDescriptionChange={(description) => setChannelEditor({ ...channelEditor, description })}
                nameId="channelName"
                descriptionId="channelDescription"
              />
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
        <ReviewSection title="Workspace">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{draft.organizationName || "Acme Product Team"}</p>
          <p className="mt-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Folder: {draft.workspaceRoot || "/Users/admin/ujima/acme-product"}
          </p>
        </ReviewSection>

        <ReviewSection title="Team summary">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300">
              <span className="inline-flex items-center gap-2">
                <Users className="h-4 w-4 text-zinc-400" />
                Agents
              </span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{draft.roles.length}</span>
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
                <Avatar name={role.agentName} colorIndex={index} size="sm" />
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{role.agentName}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{role.title}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Role template: {role.name}</p>
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
  suggestedRoles,
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
          suggestedRoles={suggestedRoles}
          onDraftChange={onDraftChange}
          errors={stepErrors}
          showError={shouldShowError}
          onFieldBlur={markFieldTouched}
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
