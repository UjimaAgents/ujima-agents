import { coreConcepts } from "./content";
import { FeatureRow, LandingContainer, LandingSection } from "./primitives";

export function CapabilitiesSection() {
  return (
    <LandingSection id="concepts">
      <LandingContainer>
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Core concepts</h2>
        <div className="mt-8">
          {coreConcepts.map((item) => (
            <FeatureRow key={item.title} title={item.title} text={item.text} />
          ))}
        </div>
      </LandingContainer>
    </LandingSection>
  );
}
