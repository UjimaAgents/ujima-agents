export interface AppRoute {
  href: string;
  label: string;
  description: string;
}

export const APP_ROUTES: AppRoute[] = [
  {
    href: "/",
    label: "Home",
    description: "Agentic command center and quick starts.",
  },
  {
    href: "/sign-in",
    label: "Sign in",
    description: "Restore a local dashboard session.",
  },
  {
    href: "/onboarding",
    label: "Onboarding",
    description: "Organization and team setup wizard.",
  },
];
