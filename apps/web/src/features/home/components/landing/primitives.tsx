import Link from "next/link";
import type { ReactNode } from "react";
import { GITHUB_URL } from "./content";
import { LandingReveal } from "./landing-reveal";

function GitHubIcon({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.01-.322 3.3 1.23.96-.266 1.98-.399 3-.404 1.02.005 2.04.138 3 .404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export const buttonPrimaryClass =
  "landing-interactive inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 hover:shadow-violet-500/30 disabled:opacity-50 disabled:shadow-none";

export const buttonSecondaryClass =
  "landing-interactive inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900";

export function LandingContainer({
  children,
  className = "",
  wide = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`mx-auto w-full px-6 ${wide ? "max-w-[1200px]" : "max-w-[680px]"} ${className}`}
    >
      {children}
    </div>
  );
}

export function LandingSection({
  id,
  children,
  className = "",
  muted = false,
  reveal = true,
  revealDelay = 0,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  muted?: boolean;
  reveal?: boolean;
  revealDelay?: number;
}) {
  const body = reveal ? <LandingReveal delay={revealDelay}>{children}</LandingReveal> : children;

  return (
    <section
      id={id}
      className={`py-20 md:py-28 ${muted ? "landing-section-muted" : "landing-section-base"} ${className}`}
    >
      {body}
    </section>
  );
}

export function PrimaryButton({
  href,
  children,
  external,
  className = "",
}: {
  href: string;
  children: string;
  external?: boolean;
  className?: string;
}) {
  const classes = `${buttonPrimaryClass} ${className}`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

function ButtonLabel({ icon, children }: { icon?: ReactNode; children: string }) {
  if (!icon) {
    return <>{children}</>;
  }

  return <span className="inline-flex items-center gap-2">{icon}{children}</span>;
}

export function SecondaryButton({
  href,
  children,
  external,
  icon,
  className = "",
}: {
  href: string;
  children: string;
  external?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const classes = `${buttonSecondaryClass} ${className}`;
  const label = <ButtonLabel icon={icon}>{children}</ButtonLabel>;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {label}
    </Link>
  );
}

const githubIcon = <GitHubIcon />;

export function GitHubButton({
  children = "GitHub",
  className = "",
}: {
  children?: string;
  className?: string;
}) {
  return (
    <SecondaryButton href={GITHUB_URL} external icon={githubIcon} className={className}>
      {children}
    </SecondaryButton>
  );
}

export function ComingSoonButton({
  children = "Coming soon",
  className = "",
}: {
  children?: string;
  className?: string;
}) {
  return (
    <span
      className={`${buttonSecondaryClass} pointer-events-none cursor-default opacity-70 ${className}`}
      aria-disabled="true"
      title="Available in a future release"
    >
      {children}
    </span>
  );
}

export function GitHubIconLink({ className = "" }: { className?: string }) {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="GitHub repository"
      className={`landing-interactive inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 ${className}`}
    >
      {githubIcon}
    </a>
  );
}

function OpenAILogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

function AnthropicLogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  );
}

function GeminiLogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
    </svg>
  );
}

function DeepSeekLogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45" />
    </svg>
  );
}

function OllamaLogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 60" fill="currentColor" className={className} aria-hidden="true">
      <path d="M25.2 14.9c2.7-1.5 6.4-2 9.7 0 .7-8.8 9.7-11 8.4 4.6 5 3.8 4.1 10.8 2.2 13 2.2 4.1 1.6 8-.2 11.3a13 13 0 0 1 .9 7.1c-.3 1.6-2.7 1.2-2.6-.4.3-2 0-4.1-1-6.2-.2-.4-.2-1 .1-1.3 1-1.5 3-5.4 0-10-.4-.6-.2-1.4.4-1.8.8-.5 1.9-3 1-6.2-1.3-4.2-5-4.7-7-4.5-.6 0-1-.3-1.3-.8-2.6-5.6-10.2-3.8-11.6-.1-.2.5-.7.8-1.2.8-2.5 0-6 .7-7.1 4.6-.8 3 .3 5.7 1 6.3.5.4.6 1 .3 1.6-.8 1.2-2.8 6.2.1 9.9.3.5.4 1 .2 1.5-1.2 2.4-1.5 4.5-1.1 6 .3 1.7-2.2 2.3-2.6.7a12 12 0 0 1 1-7.1c-3.1-4.8-.9-10.2-.3-11.5-2.1-3-2.4-9.7 2.3-13-1.3-15.3 7.6-13.6 8.4-4.5M30 26.4c4 0 7 2.8 7 5.6 0 7-14.1 6.6-14.1 0 0-2.8 3.2-5.6 7.1-5.6M24.8 32c0 4.4 10.3 4.5 10.3 0 0-1.8-2-3.8-5-3.8-2.9 0-5.3 2-5.3 3.8zm6.5-.4-.6.4v1c0 1-1.5 1-1.5 0v-1l-.6-.4c-.6-.6.3-1.7 1-1.1l.4.3.4-.3c.8-.5 1.7.5.9 1.1zm-10.4-21c-2 .9-1.6 6.9-1.5 7.7.9-.3 1.8-.4 2.8-.5 1-1.9 0-6.4-1.3-7.2zm16.9 7.3c1 0 2 .1 3 .4 0-.9.5-7-1.5-7.7-1.2.3-2.5 5.7-1.5 7.3zm2.7 10.5c0 2.4-3.6 2.4-3.6 0s3.6-2.4 3.6 0zm-17.5 0c0 2.4-3.6 2.4-3.6 0s3.6-2.4 3.6 0z" />
    </svg>
  );
}

function XAILogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z" />
    </svg>
  );
}

function MetaLogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M6.897 4c1.915 0 3.516.932 5.43 3.376l.282-.373c.19-.246.383-.484.58-.71l.313-.35C14.588 4.788 15.792 4 17.225 4c1.273 0 2.469.557 3.491 1.516l.218.213c1.73 1.765 2.917 4.71 3.053 8.026l.011.392.002.25c0 1.501-.28 2.759-.818 3.7l-.14.23-.108.153c-.301.42-.664.758-1.086 1.009l-.265.142-.087.04a3.493 3.493 0 01-.302.118 4.117 4.117 0 01-1.33.208c-.524 0-.996-.067-1.438-.215-.614-.204-1.163-.56-1.726-1.116l-.227-.235c-.753-.812-1.534-1.976-2.493-3.586l-1.43-2.41-.544-.895-1.766 3.13-.343.592C7.597 19.156 6.227 20 4.356 20c-1.21 0-2.205-.42-2.936-1.182l-.168-.184c-.484-.573-.837-1.311-1.043-2.189l-.067-.32a8.69 8.69 0 01-.136-1.288L0 14.468c.002-.745.06-1.49.174-2.23l.1-.573c.298-1.53.828-2.958 1.536-4.157l.209-.34c1.177-1.83 2.789-3.053 4.615-3.16L6.897 4zm-.033 2.615l-.201.01c-.83.083-1.606.673-2.252 1.577l-.138.199-.01.018c-.67 1.017-1.185 2.378-1.456 3.845l-.004.022a12.591 12.591 0 00-.207 2.254l.002.188c.004.18.017.36.04.54l.043.291c.092.503.257.908.486 1.208l.117.137c.303.323.698.492 1.17.492 1.1 0 1.796-.676 3.696-3.641l2.175-3.4.454-.701-.139-.198C9.11 7.3 8.084 6.616 6.864 6.616zm10.196-.552l-.176.007c-.635.048-1.223.359-1.82.933l-.196.198c-.439.462-.887 1.064-1.367 1.807l.266.398c.18.274.362.56.55.858l.293.475 1.396 2.335.695 1.114c.583.926 1.03 1.6 1.408 2.082l.213.262c.282.326.529.54.777.673l.102.05c.227.1.457.138.718.138.176.002.35-.023.518-.073.338-.104.61-.32.813-.637l.095-.163.077-.162c.194-.459.29-1.06.29-1.785l-.006-.449c-.08-2.871-.938-5.372-2.2-6.798l-.176-.189c-.67-.683-1.444-1.074-2.27-1.074z" />
    </svg>
  );
}

function OtherLogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
    </svg>
  );
}

function renderLogoSvg(logo: string, className?: string) {
  switch (logo) {
    case "openai":
    case "codex":
      return <OpenAILogo className={className} />;
    case "anthropic":
    case "claude-code":
      return <AnthropicLogo className={className} />;
    case "gemini":
      return <GeminiLogo className={className} />;
    case "deepseek":
      return <DeepSeekLogo className={className} />;
    case "ollama":
      return <OllamaLogo className={className} />;
    case "xai":
      return <XAILogo className={className} />;
    case "meta":
      return <MetaLogo className={className} />;
    case "other":
      return <OtherLogo className={className} />;
    default:
      return null;
  }
}

function getLogoLabel(logo: string): string {
  switch (logo) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "gemini":
      return "Gemini";
    case "deepseek":
      return "DeepSeek";
    case "ollama":
      return "Ollama";
    case "codex":
      return "OpenAI Codex";
    case "claude-code":
      return "Claude Code";
    case "xai":
      return "xAI";
    case "meta":
      return "Meta";
    case "other":
      return "Other providers";
    default:
      return logo;
  }
}

export function FeatureRow({
  title,
  text,
  logos,
  delay = 0,
}: {
  title: string;
  text: string;
  logos?: string[];
  delay?: number;
}) {
  return (
    <LandingReveal
      delay={delay}
      className="landing-divider grid gap-2 border-b py-6 first:pt-0 last:border-b-0 md:grid-cols-[200px_1fr] md:gap-12 md:py-8"
    >
      <h3 className="text-[17px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{title}</h3>
      <div className="flex flex-col gap-3">
        <p className="text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
        {logos && logos.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {logos.map((logo) => (
              <div
                key={logo}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 bg-zinc-50 dark:bg-zinc-900 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all duration-200 shadow-sm cursor-default"
              >
                {renderLogoSvg(logo, "h-3.5 w-3.5 shrink-0")}
                <span>{getLogoLabel(logo)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </LandingReveal>
  );
}
