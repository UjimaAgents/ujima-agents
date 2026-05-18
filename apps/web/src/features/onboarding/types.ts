import { defaultModelForProvider } from "@ujima/shared/browser";

export type OnboardingStepId = "organization" | "owner" | "team" | "review";
export type TeamTabId = "agents" | "channels" | "org-chart" | "policies" | "providers";

/**
 * Stable sentinel stored in `TeamReportDraft.managerName` when a row reports
 * to the owner. Decoupling the stored value from the owner's display name
 * means renaming the owner mid-wizard does not silently drop previously
 * configured "X reports to <owner>" edges. The daemon recognises this
 * literal in `OnboardingService.onboard` and resolves it to the owner
 * member's id.
 *
 * The `@` prefix guarantees the sentinel can never collide with a role
 * name (role names match `[a-z][a-z0-9-]*`).
 */
export const OWNER_MANAGER_SENTINEL = "@owner";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
}

export interface TeamRoleDraft {
  id: string;
  name: string;
  agentName: string;
  title: string;
  instructions: string;
  llm: string;
  model: string;
  channelIds: string[];
}

export interface TeamChannelDraft {
  id: string;
  name: string;
  description: string;
}

export interface TeamReportDraft {
  id: string;
  subjectName: string;
  managerName: string;
}

export interface TeamPoliciesDraft {
  requireApprovalForWrites: boolean;
  requireApprovalForShell: boolean;
  workspaceBoundaryMode: "hard";
}

export interface TeamProviderDraft {
  id: string;
  name: string;
  apiKey: string;
}

export interface OnboardingDraft {
  organizationName: string;
  workspaceRoot: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  roles: TeamRoleDraft[];
  channels: TeamChannelDraft[];
  organizationReports: TeamReportDraft[];
  providers: TeamProviderDraft[];
  policies: TeamPoliciesDraft;
}

export interface FlowWidgetSpec {
  id: "streaming-text" | "tool-call-ui" | "log-trace" | "canvas";
  title: string;
  purpose: string;
  bestLibrary: string;
}

export interface RolePresetTemplate {
  name: string;
  title: string;
  description: string;
  instructions: string;
  channels: string[];
  workspaceScopes?: string[];
  tools?: string[];
  skills?: string[];
  industry: string;
  key: string;
}
export { defaultModelForProvider, getModelOptionsForProvider } from "@ujima/shared/browser";

export function buildStarterDraft(): OnboardingDraft {
  return {
    ...INITIAL_DRAFT,
    roles: [],
    organizationReports: [],
  };
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "organization",
    title: "Organization",
    description: "Name your organization and the workspace root.",
  },
  {
    id: "owner",
    title: "Owner account",
    description: "Create the first owner and admin account.",
  },
  {
    id: "team",
    title: "Team configuration",
    description: "Define agents, roles, channels, and policies.",
  },
  {
    id: "review",
    title: "Review & create",
    description: "Review your configuration and initialize your workspace.",
  },
];

export const FLOW_WIDGET_SPECS: FlowWidgetSpec[] = [
  {
    id: "streaming-text",
    title: "Streaming Text",
    purpose: "Real-time feedback",
    bestLibrary: "useChat (Vercel AI SDK)",
  },
  {
    id: "tool-call-ui",
    title: "Tool Call UI",
    purpose: "Interactive elements",
    bestLibrary: "Generative UI (RSC)",
  },
  {
    id: "log-trace",
    title: "Log/Trace",
    purpose: "Debugging & Trust",
    bestLibrary: "ai-elements/call-stack",
  },
  {
    id: "canvas",
    title: "Canvas",
    purpose: "Output visualization",
    bestLibrary: "react-resizable-panels",
  },
];

export const INITIAL_DRAFT: OnboardingDraft = {
  organizationName: "",
  workspaceRoot: "",
  ownerName: "",
  ownerEmail: "",
  ownerPassword: "",
  roles: [
    {
      id: "role-senior-engineer",
      name: "senior-engineer",
      agentName: "Senior Engineer",
      title: "Senior Engineer",
      instructions: "Lead architecture, code quality, and complex implementation.",
      llm: "openai",
      model: defaultModelForProvider("openai"),
      channelIds: ["channel-general"],
    },
    {
      id: "role-junior-engineer",
      name: "junior-engineer",
      agentName: "Software Engineer",
      title: "Software Engineer",
      instructions: "Implement features, fix bugs, and write tests.",
      llm: "openai",
      model: defaultModelForProvider("openai"),
      channelIds: ["channel-general"],
    },
    {
      id: "role-reviewer",
      name: "reviewer",
      agentName: "Code Reviewer",
      title: "Code Reviewer",
      instructions: "Review changes and enforce quality standards.",
      llm: "openai",
      model: defaultModelForProvider("openai"),
      channelIds: ["channel-general"],
    },
    {
      id: "role-product-manager",
      name: "product-manager",
      agentName: "Product Manager",
      title: "Product Manager",
      instructions: "Define requirements, priorities, and product direction.",
      llm: "openai",
      model: defaultModelForProvider("openai"),
      channelIds: ["channel-general"],
    },
  ],
  channels: [
    { id: "channel-general", name: "general", description: "General discussions and updates" },
  ],
  organizationReports: [
    { id: "report-senior", subjectName: "senior-engineer", managerName: "product-manager" },
    { id: "report-junior", subjectName: "junior-engineer", managerName: "product-manager" },
    { id: "report-reviewer", subjectName: "reviewer", managerName: "product-manager" },
    { id: "report-pm", subjectName: "product-manager", managerName: OWNER_MANAGER_SENTINEL },
  ],
  providers: [
    { id: "provider-default", name: "openai", apiKey: "" },
  ],
  policies: {
    requireApprovalForWrites: true,
    requireApprovalForShell: true,
    workspaceBoundaryMode: "hard",
  },
};
