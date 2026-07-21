import type { AgentTeamHandle } from '@ujima/framework';
import { AGENT_KIND, type Member } from '@ujima/shared';

const DEFAULT_CONTEXT_WINDOW = 128_000;

export function modelContextWindowTokens(provider: string, modelId: string): number {
  const model = modelId.toLowerCase();
  const kind = provider.toLowerCase();

  if (model.includes('gpt-5.4') || model.includes('gpt-5.5')) return 1_050_000;
  if (model.includes('gpt-4.1')) return 1_047_576;
  if (model.includes('gpt-4o')) return 128_000;
  if (model.includes('deepseek-v4')) return 1_000_000;
  if (model.includes('claude-opus-4-8') || model.includes('claude-opus-4-7') || model.includes('claude-opus-4-6')) return 1_000_000;
  if (model.includes('claude-sonnet-4-6')) return 1_000_000;
  if (model.includes('claude')) return 200_000;
  if (model.includes('gemini')) return 1_048_576;
  if (model.includes('grok-build')) return 256_000;
  if (model.includes('grok-4')) return 256_000;
  if (model.includes('kimi-k2')) return 256_000;
  if (model.includes('glm-5')) return 1_000_000;
  if (model.includes('glm-4.5')) return 128_000;
  if (model.includes('mistral') || model.includes('magistral') || model.includes('devstral')) return 128_000;
  if (kind === 'ollama') return 128_000;
  return DEFAULT_CONTEXT_WINDOW;
}

export function promptCharBudget(contextWindowTokens: number): number {
  return Math.floor(contextWindowTokens * 4 * 0.7);
}

export function conversationContextWindowTokens(input: {
  team: AgentTeamHandle | null;
  members: Member[];
  threadMemberIds: string[];
}): number {
  const agents = input.members.filter((member) => member.kind === AGENT_KIND && !member.retiredAt);
  const participants = agents.filter((member) => input.threadMemberIds.includes(member.id));
  const windows = (participants.length > 0 ? participants : agents).flatMap((member) => {
    const agent = input.team?.getAgent(member.id) ?? input.team?.getAgent(member.name);
    const role = agent ? input.team?.getRole(agent.roleName) : undefined;
    const providerName = member.llm ?? role?.provider;
    const provider = providerName ? input.team?.getProvider(providerName) : undefined;
    const modelId = member.model ?? role?.model ?? provider?.defaultModel;
    return providerName && modelId
      ? [modelContextWindowTokens(provider?.kind ?? providerName, modelId)]
      : [];
  });
  return windows.length > 0 ? Math.min(...windows) : DEFAULT_CONTEXT_WINDOW;
}
