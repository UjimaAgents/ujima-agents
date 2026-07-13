import { redirect } from "next/navigation";
import { getServerBootstrap } from "@/server/ujima-daemon";
import { DaemonUnavailablePanel } from "@/features/system/daemon-unavailable-panel";
import { WorkflowsList } from "@/features/workflows/workflows-list";

export const dynamic = "force-dynamic";

export default async function WorkflowsRoute() {
  const bootstrap = await getServerBootstrap().catch(() => null);
  if (!bootstrap) {
    return <DaemonUnavailablePanel />;
  }
  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }
  if (!bootstrap.auth.authenticated) {
    redirect("/login");
  }
  return <WorkflowsList />;
}
