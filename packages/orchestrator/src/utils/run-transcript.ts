export function buildRunTranscript(
  steps: {
    createdAt: string;
    toolId: string;
    action: string;
    resourcePath: string;
    input: Record<string, unknown>;
    output?: unknown;
    status: string;
  }[],
): string {
  if (!steps.length) return '';
  const lines = steps.slice(-20).map((step) => {
    const input = truncate(JSON.stringify(step.input));
    const output = formatStepOutput(step.output);
    return [
      `- ${step.createdAt}`,
      `Tool: ${step.toolId}.${step.action}`,
      step.resourcePath ? `Resource: ${step.resourcePath}` : '',
      input ? `Input: ${input}` : '',
      `Status: ${step.status}`,
      output ? `Output:\n${output}` : '',
    ].filter(Boolean).join('\n');
  });
  return [
    'Current run transcript from before the approval pause:',
    'Continue from this state. Do not repeat tool calls that already have useful output.',
    lines.join('\n\n'),
  ].join('\n\n');
}

function formatStepOutput(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '');
  const output = value as { stdout?: unknown; stderr?: unknown };
  const stdout = typeof output.stdout === 'string' ? output.stdout.trim() : '';
  const stderr = typeof output.stderr === 'string' ? output.stderr.trim() : '';
  const text = [stdout ? `stdout:\n${stdout}` : '', stderr ? `stderr:\n${stderr}` : '']
    .filter(Boolean)
    .join('\n');
  return text || truncate(JSON.stringify(value));
}

function truncate(value: string): string {
  return value.length > 4000 ? `${value.slice(0, 4000)}\n[truncated]` : value;
}
