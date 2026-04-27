export interface AppRoute {
  href: string;
  label: string;
  description: string;
}

export const APP_ROUTES: AppRoute[] = [
  {
    href: "/workspace",
    label: "Workspace",
    description: "Organization dashboard and control plane.",
  },
];
