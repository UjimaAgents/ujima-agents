import { landingFont } from "@/lib/landing-font";
import { CapabilitiesSection } from "./landing/capabilities-section";
import { ContactSection } from "./landing/contact-section";
import { HeroSection } from "./landing/hero-section";
import { InstallSection } from "./landing/install-section";
import { LandingFooter } from "./landing/landing-footer";
import { LandingHeader } from "./landing/landing-header";
import { PersonasSection } from "./landing/personas-section";
import { SecuritySection } from "./landing/security-section";
import { WorkflowSection } from "./landing/workflow-section";
import { IndustryCarousel } from "./landing/industry-carousel";

export function LandingPage() {
  return (
    <main className={`landing ${landingFont.className}`}>
      <div className="relative">
        <LandingHeader />
        <HeroSection />
      </div>
      <InstallSection />
      <CapabilitiesSection />
      <WorkflowSection />
      <IndustryCarousel />
      <PersonasSection />
      <SecuritySection />
      <ContactSection />
      <LandingFooter />
    </main>
  );
}
