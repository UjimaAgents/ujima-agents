import { OnboardingExperience } from "@/features/onboarding/onboarding-experience";
import { buildStarterDraft, INITIAL_DRAFT, type RolePresetTemplate } from "@/features/onboarding/types";
import { getServerBootstrap, getServerRolePresets } from "@/server/ujima-daemon";
import { redirect } from "next/navigation";

export default async function OnboardingPage() {
  try {
    const bootstrap = await getServerBootstrap();
    if (bootstrap.onboardingStatus === "ready") {
      redirect(bootstrap.auth.authenticated ? "/workspace" : "/login");
    }
  } catch {
    // If the daemon is offline, still let the onboarding UI render so the
    // user can prepare the draft before the API becomes reachable.
  }

  const starterDraft = buildStarterDraft();
  let roleTemplates: RolePresetTemplate[] = [];

  try {
    roleTemplates = await getServerRolePresets();
  } catch {
    // Fall back to the local starter draft if the role catalog is unavailable.
    roleTemplates = INITIAL_DRAFT.roles.map((role) => ({
      name: role.name,
      title: role.title,
      description: role.instructions,
      instructions: role.instructions,
      channels: [],
      industry: "general",
      key: role.name,
    }));
  }

  return <OnboardingExperience starterDraft={starterDraft} roleTemplates={roleTemplates} />;
}
