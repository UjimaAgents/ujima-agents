import { redirect } from "next/navigation";
import { getServerBootstrap, getServerRolePresets } from "@/server/ujima-daemon";
import { WorkspaceShell } from "@/features/workspace/components/workspace-shell";
import { resolveSelectedConversationFromSearchParams } from "@/features/workspace/conversation-routing";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const bootstrap = await getServerBootstrap();
  const rolePresets = await getServerRolePresets().catch(() => []);

  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }
  if (
    !bootstrap.auth.authenticated ||
    !bootstrap.auth.user ||
    !bootstrap.auth.member
  ) {
    redirect("/login");
  }

  const fallbackChannel =
    bootstrap.channels.find((c) => c.name === "general") ?? bootstrap.channels[0];
  const initialConversation =
    resolveSelectedConversationFromSearchParams(searchParams, bootstrap) ??
    (fallbackChannel
      ? {
          type: "channel" as const,
          id: fallbackChannel.id,
          name: fallbackChannel.name,
        }
      : undefined);

  return (
    <WorkspaceShell
      bootstrap={bootstrap}
      rolePresets={rolePresets}
      initialConversation={initialConversation}
    />
  );
}
