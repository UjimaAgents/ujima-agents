export interface AppRoute {
  href: string;
  label: string;
  description: string;
}

export const APP_ROUTES: AppRoute[] = [
  {
    href: "/workspace",
    label: "Workspace",
    description: "Workspace dashboard and control plane.",
  },
  {
    href: "/workflows",
    label: "Workflows",
    description: "Author SOP workflows — sequenced agent pipelines.",
  },
  {
    href: "/settings/organization",
    label: "Settings",
    description: "Workspace settings and configuration.",
  },
];
