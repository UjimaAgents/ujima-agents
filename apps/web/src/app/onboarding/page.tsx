import { OnboardingExperience } from "@/features/onboarding/onboarding-experience";
import { getServerBootstrap } from "@/server/ujima-daemon";
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

  return <OnboardingExperience />;
}
