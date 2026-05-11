const SENSITIVE_NAMES = new Set([
  '.git-credentials',
  '.netrc',
  '.npmrc',
]);

const SENSITIVE_DIRS = new Set([
  '.aws',
  '.git',
  '.ssh',
]);

const SENSITIVE_SUFFIXES = [
  '.cer',
  '.crt',
  '.der',
  '.env',
  '.key',
  '.p12',
  '.pem',
  '.pfx',
];

export function isSensitiveWorkspacePath(filePath: string): boolean {
  const parts = filePath.split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] ?? '';
  if (!name) return false;

  if (name.startsWith('.env')) return true;
  if (SENSITIVE_NAMES.has(name)) return true;
  if (SENSITIVE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return parts.some((part) => SENSITIVE_DIRS.has(part));
}
