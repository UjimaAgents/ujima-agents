import { redirect } from "next/navigation";
import {
  daemonBaseUrl,
  getServerBootstrap,
  getServerRolePresets,
  getServerTeamSettings,
} from "@/server/ujima-daemon";
import { WorkspaceShell } from "@/features/workspace/components/workspace-shell";
import { resolveSelectedConversationFromSearchParams } from "@/features/workspace/conversation-routing";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const bootstrap = await getServerBootstrap().catch(() => null);
  if (!bootstrap) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-[#09090b]">
        <div className="max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Workspace daemon is unavailable
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Could not reach the local Ujima daemon at <code>{daemonBaseUrl()}</code>.
            Start the daemon, then refresh this page.
          </p>
        </div>
      </main>
    );
  }
  const rolePresets = await getServerRolePresets().catch(() => []);
  const teamSettings = await getServerTeamSettings().catch(() => null);

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
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const initialConversation =
    resolveSelectedConversationFromSearchParams(resolvedSearchParams, bootstrap) ??
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
      teamSettings={teamSettings}
      initialConversation={initialConversation}
    />
  );
}
