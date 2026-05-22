// File / directory / suffix patterns that gate read access behind
// an approval. Read-only filesystem is now default-on for every role
// (`ALWAYS_AVAILABLE_AGENT_TOOLS` includes `view`/`ls`/`glob`/`grep`),
// so this filter is the only protection against agents inadvertently
// reading credentials, deploy tokens, or cloud-provider secrets out
// of the workspace.
//
// Maintenance note: when adding a new entry, also add a test case in
// `packages/shared/src/index.test.ts` so the matching logic doesn't
// silently regress.
const SENSITIVE_NAMES = new Set([
  '.git-credentials',
  '.netrc',
  '.npmrc',
  // Common credential-file names that don't have a sensitive suffix
  // and so wouldn't be caught by the suffix list. The QA review
  // specifically flagged that the previous list was too narrow.
  'credentials.json',
  'service-account.json',
  'service-account-key.json',
  'secrets.yaml',
  'secrets.yml',
  'firebase-adminsdk.json',
  'gha-creds.json',
  'token.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'authorized_keys',
  'known_hosts',
]);

const SENSITIVE_DIRS = new Set([
  '.aws',
  '.git',
  '.ssh',
  '.gcloud',
  '.azure',
  '.docker',
  '.kube',
  '.codex',
  'secrets',
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
  // Provisioning / deploy / cloud secrets that travel as plain files.
  '.tfvars',
  '.tfvars.json',
  '.kubeconfig',
  '.pgpass',
  '.htpasswd',
  '.keystore',
  '.jks',
  '.gpg',
  '.asc',
];

// Pattern matching for filenames that don't fit clean
// suffix/dir/name buckets — e.g. `id_rsa.bak`, `id_rsa.old`,
// `*.private.pem`, `.npmrc.local`, dotfile variants of the
// credential-name set.
const SENSITIVE_PATTERNS: RegExp[] = [
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:[._-]|$)/i,
  /^\.?npmrc(?:[._-]|$)/i,
  /^\.?netrc(?:[._-]|$)/i,
  /(^|[._-])private[._-]key(\.|$)/i,
];

export function isSensitiveWorkspacePath(filePath: string): boolean {
  const parts = filePath.split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] ?? '';
  if (!name) return false;

  if (name.startsWith('.env')) return true;
  if (SENSITIVE_NAMES.has(name)) return true;
  if (SENSITIVE_NAMES.has(name.toLowerCase())) return true;
  if (SENSITIVE_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))) return true;
  if (parts.some((part) => SENSITIVE_DIRS.has(part))) return true;
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(name))) return true;
  return false;
}
