import { LandingPage } from "@/features/home/components/landing-page";
import { getServerBootstrap } from "@/server/ujima-daemon";
import { redirect } from "next/navigation";

export default async function Home() {
  try {
    const bootstrap = await getServerBootstrap();
    if (bootstrap.auth.authenticated) {
      redirect("/workspace");
    }
    if (bootstrap.onboardingStatus === "ready") {
      redirect("/login");
    }
  } catch {
    // If the daemon is unavailable, keep the public landing page visible
    // instead of crashing the whole web shell during first launch.
  }

  return <LandingPage />;
}
