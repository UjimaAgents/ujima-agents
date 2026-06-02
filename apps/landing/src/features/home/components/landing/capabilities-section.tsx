import { coreConcepts } from "./content";
import { LandingReveal } from "./landing-reveal";
import { FeatureRow, LandingContainer, LandingSection } from "./primitives";

export function CapabilitiesSection() {
  return (
    <LandingSection id="concepts" reveal={false}>
      <LandingContainer>
        <LandingReveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Core concepts</h2>
        </LandingReveal>
        <div className="mt-8">
          {coreConcepts.map((item, index) => (
            <FeatureRow key={item.title} title={item.title} text={item.text} delay={index * 80} />
          ))}
        </div>
      </LandingContainer>
    </LandingSection>
  );
}
