export const GITHUB_URL = "https://github.com/UjimaAgents/ujima-agents";

export const headerLinks = [
  {label: "Concepts", href: "#concepts"},
  {label: "Install", href: "#install"},
  {label: "Surfaces", href: "#surfaces"},
  {label: "Start", href: "#quick-start"},
  {label: "Contact", href: "#contact"},
];

export const install = {
  eyebrow: "Install",
  title: "Get the CLI from npm",
  description:
    "Install globally, then run ujima init and ujima start in your project.",
  npmCommand: "npm install -g @ujima/agents",
  bunCommand: "bun add -g @ujima/agents",
};

export const hero = {
  eyebrow: "Install from npm — open source coming soon",
  headline: "AI agents, organized like a team.",
  body: "Channels, roles, and approvals — every action bounded to your workspace.",
  primaryCta: "Get started",
};

export const coreConcepts = [
  {title: "Organization", text: "Persistent members tied to a workspace root."},
  {title: "Roles", text: "Typed roles set tools, instructions, and scope."},
  {title: "Channels", text: "Agents respond on @mention, not every thread."},
  {title: "Task runs", text: "Focused work in dedicated run channels."},
  {title: "Approvals", text: "Writes, shell, and git wait for your OK."},
  {title: "Bounds", text: "Execution cannot escape the org root."},
];

export const workflowSteps = [
  {step: "01", title: "ujima init", text: "Name your org and workspace."},
  {
    step: "02",
    title: "ujima start",
    text: "API, web, and editor share one runtime.",
  },
  {
    step: "03",
    title: "Sign in",
    text: "Channels and approvals at localhost:3452.",
  },
];

export type ProductSurface =
  | {
      title: string;
      text: string;
      comingSoon: true;
    }
  | {
      title: string;
      text: string;
      href: string;
      external?: boolean;
    };

export const productSurfaces: ProductSurface[] = [
  {
    title: "Web",
    text: "Channels, DMs, mentions, approvals.",
    href: "/onboarding",
    external: false,
  },
  { title: "VS Code", text: "Same team inside your editor.", comingSoon: true },
  {
    title: "CLI",
    text: "Install from npm, then init and start.",
    href: "#install",
    external: false,
  },
];

export const securityLines = [
  "Provider keys stay in the local daemon.",
  "Filesystem and shell resolve under workspaceRoot.",
  "Sensitive operations require explicit approval.",
  "Role scopes can limit agents to subtrees.",
];

export type Contributor = {
  name: string;
  role: string;
  contactLabel: string;
  contactHref: string;
};

export const contributors: Contributor[] = [
  {
    name: "Vincent Precious",
    role: "Contributor",
    contactLabel: "@vincent_presh",
    contactHref: "https://x.com/vincent_presh",
  },
  {
    name: "Oluwaseyi Ajadi",
    role: "Contributor",
    contactLabel: "oluwaseyinexus137@gmail.com",
    contactHref: "mailto:oluwaseyinexus137@gmail.com",
  },
  {
    name: "Israel Akin-Akinsanya",
    role: "Contributor",
    contactLabel: "israelakinakinsanya@gmail.com",
    contactHref: "mailto:israelakinakinsanya@gmail.com",
  },
];
