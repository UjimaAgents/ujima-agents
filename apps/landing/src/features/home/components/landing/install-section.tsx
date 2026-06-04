import { install } from "./content";
import { InstallCommand } from "./install-command";
import { LandingContainer, LandingSection } from "./primitives";

export function InstallSection() {
  return (
    <LandingSection id="install" muted>
      <LandingContainer>
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{install.eyebrow}</h2>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{install.title}</p>
        <p className="mt-2 text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{install.description}</p>
        <InstallCommand command={install.npmCommand} />
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-500">
          Using Bun? <code className="font-mono text-zinc-700 dark:text-zinc-300">{install.bunCommand}</code>
        </p>
      </LandingContainer>
    </LandingSection>
  );
}
