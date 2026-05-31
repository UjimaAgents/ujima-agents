import {
  AiService,
  ConversationService,
  SpiritService,
  TaskSessionService,
  type ModelResolver,
  type ToolService,
} from '@ujima/orchestrator';
import { createOnboardedFixture } from './create-onboarded-fixture.js';
import { noopRealtime } from './noop-realtime.js';
import { CHANNEL_AGENT_TOOLS, FRONTEND_CHANNELS, FRONTEND_ENGINEER_ROLE } from './onboarded-team-presets.js';

export interface TaskShellFixtureOptions {
  modelResolver?: ModelResolver;
}

export async function createTaskShellFixture(opts: TaskShellFixtureOptions = {}) {
  const base = await createOnboardedFixture({
    organizationName: 'Task Shell Org',
    team: {
      channels: FRONTEND_CHANNELS,
      roles: [{ ...FRONTEND_ENGINEER_ROLE, tools: [...CHANNEL_AGENT_TOOLS] }],
      agents: [
        { name: 'frontend-alice', roleName: 'frontend-engineer', personalityName: 'direct' },
        { name: 'frontend-bob', roleName: 'frontend-engineer', personalityName: 'direct' },
      ],
    },
  });

  const conversations = new ConversationService(base.repo, noopRealtime());
  const tools: ToolService = {
    allowRun: () => undefined,
    invoke: async () => ({ ok: true, output: { status: 'completed', result: 'ok' } }),
  };
  const ai = new AiService(base.teamStore, base.repo, tools);
  const spirits = new SpiritService(base.teamStore, base.repo, noopRealtime(), tools, {
    conversations,
    ai,
    modelResolver: opts.modelResolver,
  });
  const taskSessions = new TaskSessionService(base.repo, conversations, spirits);

  return {
    archiveRoot: base.archiveRoot,
    repo: base.repo,
    conversations,
    taskSessions,
    runs: spirits,
    organizationId: base.organizationId,
    ownerId: base.ownerId,
  };
}
