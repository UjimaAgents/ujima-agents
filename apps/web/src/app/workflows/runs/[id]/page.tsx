import { redirect } from "next/navigation";
import { getServerBootstrap } from "@/server/ujima-daemon";
import { DaemonUnavailablePanel } from "@/features/system/daemon-unavailable-panel";
import { WorkflowRunView } from "@/features/workflows/workflow-run-view";

export const dynamic = "force-dynamic";

export default async function WorkflowRunRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  return (
    <div className="h-[calc(100vh-8rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <WorkflowRunView runId={id} />
    </div>
  );
}
