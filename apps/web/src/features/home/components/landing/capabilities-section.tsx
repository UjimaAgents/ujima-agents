import { coreConcepts } from "./content";
import { LandingReveal } from "./landing-reveal";
import { FeatureRow, LandingContainer, LandingSection } from "./primitives";
import { CollaborativeMesh } from "./illustrations";

export function CapabilitiesSection() {
  return (
    <LandingSection id="concepts" reveal={false}>
      <LandingContainer>
        <LandingReveal revealType="3d">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Core concepts</h2>
        </LandingReveal>
        <LandingReveal revealType="3d" delay={80} className="mt-8 mb-12">
          <CollaborativeMesh />
        </LandingReveal>
        <div className="mt-8">
          {coreConcepts.map((item, index) => (
            <FeatureRow
              key={item.title}
              title={item.title}
              text={item.text}
              logos={"logos" in item ? item.logos : undefined}
              delay={index * 80}
            />
          ))}
        </div>
      </LandingContainer>
    </LandingSection>
  );
}
