export type OnboardingStepId = "organization" | "owner" | "team" | "review";
export type TeamTabId = "agents" | "channels" | "org-chart" | "policies" | "providers";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
}

export interface TeamRoleDraft {
  id: string;
  name: string;
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
      title: "Senior Engineer",
      instructions: "Lead architecture, code quality, and complex implementation.",
      llm: "Anthropic",
      model: "claude-3-5-sonnet",
      channelIds: ["channel-engineering", "channel-reviews", "channel-general"],
    },
    {
      id: "role-junior-engineer",
      name: "junior-engineer",
      title: "Software Engineer",
      instructions: "Implement features, fix bugs, and write tests.",
      llm: "Anthropic",
      model: "claude-3-5-sonnet",
      channelIds: ["channel-engineering", "channel-general"],
    },
    {
      id: "role-reviewer",
      name: "reviewer",
      title: "Code Reviewer",
      instructions: "Review changes and enforce quality standards.",
      llm: "Anthropic",
      model: "claude-3-5-sonnet",
      channelIds: ["channel-reviews", "channel-general"],
    },
    {
      id: "role-product-manager",
      name: "product-manager",
      title: "Product Manager",
      instructions: "Define requirements, priorities, and product direction.",
      llm: "OpenAI",
      model: "gpt-4.1",
      channelIds: ["channel-product", "channel-general"],
    },
  ],
  channels: [
    { id: "channel-general", name: "general", description: "General discussions and updates" },
    { id: "channel-engineering", name: "engineering", description: "Engineering and implementation" },
    { id: "channel-reviews", name: "reviews", description: "Code reviews and quality" },
    { id: "channel-product", name: "product", description: "Product planning and updates" },
  ],
  organizationReports: [
    { id: "report-senior", subjectName: "senior-engineer", managerName: "product-manager" },
    { id: "report-junior", subjectName: "junior-engineer", managerName: "product-manager" },
    { id: "report-reviewer", subjectName: "reviewer", managerName: "product-manager" },
    { id: "report-pm", subjectName: "product-manager", managerName: "Owner" },
  ],
  providers: [
    { id: "provider-openai", name: "openai", apiKey: "" },
    { id: "provider-anthropic", name: "anthropic", apiKey: "" },
  ],
  policies: {
    requireApprovalForWrites: true,
    requireApprovalForShell: true,
    workspaceBoundaryMode: "hard",
  },
};
