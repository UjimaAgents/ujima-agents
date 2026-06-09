import type { MessageToolCall } from '@ujima/shared';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import { normalizeRunStepToolCalls } from '../utils/step-tool-calls.js';
import { appendArtifactFileToolCall } from './artifact-file-card.js';
import type { AgentLoopStep } from './agent-loop.js';
import { runUsedThreadPublishingTool, stepContainsSilentTerminator } from './run-reply-guard.js';

export interface StepPublicationTerminatorState {
  sawTerminatingTool: boolean;
}

export interface PrepareAgentStepPublicationInput {
  step: AgentLoopStep;
  teamRoot: string;
  reasoningFallback?: string;
  allowEmptyWithoutArtifact?: boolean;
  suppressSilentTerminatorText?: boolean;
  terminatorState?: StepPublicationTerminatorState;
  resolveRunStepArtifact?: (lastToolCallId?: string) => Promise<MessageToolCall | undefined>;
  isStepTerminated?: (step: AgentLoopStep) => boolean;
}

export interface PreparedAgentStepPublication {
  content: string;
  stepToolCalls: MessageToolCall[];
  artifact?: MessageToolCall;
  reasoningContent?: string;
  artifactPublished: boolean;
  stepText: string;
  toolCallCount: number;
}

export function composedStepToolCalls(prepared: PreparedAgentStepPublication): MessageToolCall[] {
  return [...prepared.stepToolCalls, ...(prepared.artifact ? [prepared.artifact] : [])];
}

export async function prepareAgentStepPublication(
  input: PrepareAgentStepPublicationInput,
): Promise<PreparedAgentStepPublication | null> {
  const stepText = typeof input.step.text === 'string' ? input.step.text.trim() : '';
  const stepToolCalls = Array.isArray(input.step.toolCalls) ? input.step.toolCalls : [];
  const stepToolResults = Array.isArray(input.step.toolResults) ? input.step.toolResults : [];
  if (!stepText && stepToolCalls.length === 0) return null;

  let artifact: MessageToolCall | undefined;
  if (stepToolCalls.length > 0) {
    artifact = await appendArtifactFileToolCall(stepToolCalls, input.teamRoot, stepToolResults);
    if (!artifact && input.resolveRunStepArtifact) {
      artifact = await input.resolveRunStepArtifact(stepToolCalls.at(-1)?.toolCallId);
    }
  }

  const stepTerminatedRun = input.isStepTerminated
    ? input.isStepTerminated(input.step)
    : runUsedThreadPublishingTool({ steps: [input.step] });
  const terminatorState = input.terminatorState;
  if (terminatorState) {
    if (terminatorState.sawTerminatingTool || (stepTerminatedRun && !artifact)) {
      if (stepTerminatedRun) terminatorState.sawTerminatingTool = true;
      return null;
    }
    if (stepTerminatedRun) terminatorState.sawTerminatingTool = true;
  }

  if (input.suppressSilentTerminatorText && stepContainsSilentTerminator(input.step)) {
    return null;
  }

  if (!stepText && !artifact && !input.allowEmptyWithoutArtifact) {
    return null;
  }

  const content = stepText || (artifact ? 'Artifact updated.' : '');
  const normalizedToolCalls = normalizeRunStepToolCalls(stepToolCalls, stepToolResults);
  const reasoningContent = extractReasoningChunk(input.step) ?? input.reasoningFallback;

  return {
    content,
    stepToolCalls: normalizedToolCalls,
    artifact,
    reasoningContent,
    artifactPublished: Boolean(artifact),
    stepText,
    toolCallCount: stepToolCalls.length,
  };
}
