/** Split CLI args on newlines or commas. */
export function parseArgsInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Parse `KEY=value` lines into a secret map. Empty input → undefined. */
export function parseSecretMapInput(value: string): Record<string, string> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const out: Record<string, string> = {};
  for (const line of trimmed.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const secret = line.slice(eq + 1).trim();
    if (key) out[key] = secret;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function formatArgsInput(args: string[]): string {
  return args.join("\n");
}

/** Hint text listing configured secret key names (values are never shown). */
export function formatSecretKeysHint(keys: string[]): string {
  if (keys.length === 0) return "";
  return keys.map((key) => `${key}=`).join("\n");
}
