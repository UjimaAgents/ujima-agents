"use client";

import { DashboardHome } from "./dashboard-home";
import { LandingPage } from "./landing-page";
import { useWebSession } from "@/features/auth/use-web-session";

export function HomePage() {
  const session = useWebSession();

  if (session) {
    return <DashboardHome session={session} />;
  }

  return <LandingPage />;
}
