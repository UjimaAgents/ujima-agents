export function toModelToolName(toolId: string): string {
  return toolId.replace(/[^a-zA-Z0-9_-]/g, '_');
}
