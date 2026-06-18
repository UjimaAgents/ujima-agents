import {
  MessageCardSchema,
  type MessageCard,
} from "@ujima/shared/browser";
import type { ChatMessageData } from "./chat-message";

export interface ArtifactFileView {
  name: string;
  filePath: string;
  content: string;
  diff?: string;
  artifactFormat: "html" | "markdown";
  status: string;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function parseCardFromToolCall(entry: NonNullable<ChatMessageData["toolCalls"]>[number]): MessageCard | null {
  if (!entry.toolName.startsWith("card.")) return null;
  const parsed = MessageCardSchema.safeParse(entry.args);
  return parsed.success ? parsed.data : null;
}

export function getMessageCards(toolCalls?: ChatMessageData["toolCalls"]): MessageCard[] {
  if (!toolCalls?.length) return [];
  return toolCalls.flatMap((entry) => {
    const card = parseCardFromToolCall(entry);
    return card ? [card] : [];
  });
}

export function getArtifactFileCard(toolCalls?: ChatMessageData["toolCalls"]): ArtifactFileView | null {
  const card = toolCalls?.find(
    (entry) => entry.toolName === "card.artifact.file" || entry.toolName === "card.goal.file",
  );
  if (!card) return null;
  const name = stringArg(card.args, "name") ?? stringArg(card.args, "goalName");
  const filePath = stringArg(card.args, "filePath") ?? stringArg(card.args, "goalFilePath");
  const html = stringArg(card.args, "html");
  const diff = stringArg(card.args, "diff");
  const artifactFormat = card.args.artifactFormat;
  const status = stringArg(card.args, "status");
  if (!name || !filePath || !html || !status) return null;
  return {
    name,
    filePath,
    content: html,
    diff,
    artifactFormat: artifactFormat === "html" ? "html" : "markdown",
    status,
  };
}

export function hasStructuredChatCard(toolCalls?: ChatMessageData["toolCalls"]): boolean {
  if (getArtifactFileCard(toolCalls)) return true;
  return getMessageCards(toolCalls).some((card) => card.kind !== "tool.call");
}

const BOILERPLATE_STEP_CONTENT = new Set(["Artifact updated.", "Task board updated.", "Schedule updated."]);

export function isBoilerplateStepContent(content: string): boolean {
  return BOILERPLATE_STEP_CONTENT.has(content.trim());
}
