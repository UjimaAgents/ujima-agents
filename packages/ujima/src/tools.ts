import {
  ToolCapabilitySchema,
  type ToolCapability,
} from "@ujima/shared";
import { DEFAULT_TOOL_CATALOG } from "./constants.js";

export function defineTool(tool: unknown): ToolCapability {
  return ToolCapabilitySchema.parse(tool);
}

export function listDefaultToolNames(): string[] {
  return Object.keys(DEFAULT_TOOL_CATALOG);
}

export function normalizeTools(
  tools: Record<string, unknown> = {},
): Record<string, ToolCapability> {
  const catalog = Object.keys(tools).length ? tools : DEFAULT_TOOL_CATALOG;

  return Object.fromEntries(
    Object.entries(catalog).map(([id, tool]) => {
      const record = typeof tool === "object" && tool !== null ? tool : {};
      return [id, ToolCapabilitySchema.parse({ id, ...record })];
    }),
  );
}
