import { securityLines } from "./content";
import { LandingContainer, LandingSection } from "./primitives";

export function SecuritySection() {
  return (
    <LandingSection muted>
      <LandingContainer>
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Security</h2>
        <ul className="mt-8 space-y-4">
          {securityLines.map((line) => (
            <li
              key={line}
              className="landing-divider border-b py-4 text-[17px] leading-relaxed text-zinc-600 last:border-b-0 dark:text-zinc-400"
            >
              {line}
            </li>
          ))}
        </ul>
      </LandingContainer>
    </LandingSection>
  );
}
