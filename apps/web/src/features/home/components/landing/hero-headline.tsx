import { hero } from "./content";

export function HeroHeadline() {
  const words = hero.headline.split(" ");

  return (
    <div className="landing-hero-enter landing-hero-delay-1 mt-5">
      <h1 className="hero-headline text-[2.75rem] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[4.5rem] md:leading-[1.05] lg:text-[5.25rem]">
        {words.map((word, index) => (
          <span key={`${word}-${index}`} className="hero-word">
            {word}
            {index < words.length - 1 ? "\u00a0" : ""}
          </span>
        ))}
      </h1>
    </div>
  );
}
