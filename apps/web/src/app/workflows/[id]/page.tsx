import { redirect } from "next/navigation";
import { getServerBootstrap } from "@/server/ujima-daemon";
import { DaemonUnavailablePanel } from "@/features/system/daemon-unavailable-panel";
import { WorkflowEditor } from "@/features/workflows/workflow-editor";

export const dynamic = "force-dynamic";

export default async function WorkflowEditorRoute({
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
      <WorkflowEditor workflowId={id} />
    </div>
  );
}
