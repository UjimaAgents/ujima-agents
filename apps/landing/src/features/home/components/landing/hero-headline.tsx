import { hero } from "./content";

export function HeroHeadline() {
  const words = hero.headline.split(" ");

  return (
    <div className="landing-hero-enter landing-hero-delay-1 mt-5 overflow-visible px-1">
      <h1 className="hero-headline mx-auto max-w-4xl text-balance text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[3.25rem] md:text-[4rem] md:leading-[1.05] lg:text-[4.75rem]">
        {words.map((word, index) => (
          <span key={`${word}-${index}`} className="hero-word inline-block">
            {word}
            {index < words.length - 1 ? "\u00a0" : ""}
          </span>
        ))}
      </h1>
    </div>
  );
}
