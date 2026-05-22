export type PathEscapeReason = 'workspace' | 'scope';

export function formatPathEscapeError(params: {
  requested: string;
  resolved: string;
  root: string;
  scopePaths: readonly string[];
  reason: PathEscapeReason;
}): string {
  if (params.reason === 'scope' && params.scopePaths.length > 0) {
    return (
      `path not allowed: "${params.requested}" resolved to "${params.resolved}" ` +
      `which is outside allowed scope(s): ${params.scopePaths.join(', ')} ` +
      `(workspace root: "${params.root}")`
    );
  }
  return (
    `path escape: "${params.requested}" resolved to "${params.resolved}" ` +
    `which is outside workspace root "${params.root}"`
  );
}
