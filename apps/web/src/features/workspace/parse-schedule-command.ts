export function parseScheduleCommand(content: string): { cronExpression: string; prompt: string } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/schedule")) return null;

  const withoutCommand = trimmed.slice("/schedule".length).trim();
  if (!withoutCommand) return null;

  const parts = withoutCommand.split(/\s+/);
  if (parts.length < 6) return null;

  const cronExpression = parts.slice(0, 5).join(" ");
  const prompt = parts.slice(5).join(" ").trim();
  if (!prompt) return null;

  return { cronExpression, prompt };
}
