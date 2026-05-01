import { redirect } from "next/navigation";
import { getServerBootstrap, getServerRolePresets } from "@/server/ujima-daemon";
import { WorkspaceShell } from "@/features/workspace/components/workspace-shell";
import type { SelectedConversation } from "@/features/workspace/types";

function resolveSelectedConversation(
  searchParams?: Record<string, string | string[] | undefined>,
  bootstrap?: Awaited<ReturnType<typeof getServerBootstrap>>,
): SelectedConversation | undefined {
  if (!searchParams || !bootstrap) return;

  const agentValue = typeof searchParams.agent === "string" ? searchParams.agent : undefined;
  if (agentValue) {
    const agent = bootstrap.members.find(
      (member) => member.kind === "agent" && (member.name === agentValue || member.id === agentValue),
    );
    if (agent) {
      return { type: "agent", id: agent.id, name: agent.name };
    }
  }

  const channelValue = typeof searchParams.channel === "string" ? searchParams.channel : undefined;
  if (channelValue) {
    const channel = bootstrap.channels.find(
      (item) => item.name === channelValue || item.id === channelValue,
    );
    if (channel) {
      return { type: "channel", id: channel.id, name: channel.name };
    }
  }
}

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const bootstrap = await getServerBootstrap();
  const rolePresets = await getServerRolePresets();

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
    resolveSelectedConversation(searchParams, bootstrap) ??
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
