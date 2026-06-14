import type { LanguageModel } from 'ai';
import {
  ActiveSpiritRegistry,
  ConversationService,
  GoalSystemService,
  SpiritService,
  TaskSessionService,
  ToolServiceImpl,
  type ApiRepository,
  type ApprovalRequester,
  type ModelResolver,
  type SpiritServiceOptions,
  type ToolInvocationInput,
  type ToolInvocationResult,
  type ToolService,
} from '@ujima/orchestrator';
import { createOnboardedFixture } from './create-onboarded-fixture.js';
import { makeTextOnlyModel } from './mock-language-models.js';
import { noopRealtime } from './noop-realtime.js';
import { spiritsOnboardTeam } from './onboarded-team-presets.js';

export interface SpiritFixtureOptions {
  modelByCall?: LanguageModel[];
  staticModel?: LanguageModel;
  agentNames?: string[];
  realToolPipeline?: boolean;
  mcpPool?: SpiritServiceOptions['mcpPool'];
  mcpResolver?: SpiritServiceOptions['mcpResolver'];
  toolInvoke?: (input: ToolInvocationInput) => ToolInvocationResult | Promise<ToolInvocationResult>;
}

export interface ModelCall {
  organizationId: string;
  memberId: string;
  role: 'worker' | 'supervisor';
}

export interface SpiritFixture {
  archiveRoot: string;
  repo: ApiRepository;
  conversations: ConversationService;
  spirits: SpiritService;
  goals: GoalSystemService;
  taskSessions: TaskSessionService;
  registry: ActiveSpiritRegistry;
  tools: ToolService;
  organizationId: string;
  ownerId: string;
  modelCalls: { input: ModelCall; resolved: LanguageModel }[];
}

export async function createSpiritTestFixture(opts: SpiritFixtureOptions = {}): Promise<SpiritFixture> {
  const agentNames = opts.agentNames ?? ['frontend-alice'];
  const base = await createOnboardedFixture({
    organizationName: 'Phase 2 Org',
    providerKeys: { local: 'sk-test' },
    team: spiritsOnboardTeam(agentNames),
  });

  const conversations = new ConversationService(base.repo, noopRealtime());
  const goals = new GoalSystemService(base.repo);

  const modelCalls: { input: ModelCall; resolved: LanguageModel }[] = [];
  let queueIndex = 0;
  const modelResolver: ModelResolver = (input) => {
    let resolved: LanguageModel;
    if (opts.modelByCall?.length) {
      resolved = opts.modelByCall[queueIndex % opts.modelByCall.length]!;
      queueIndex += 1;
    } else if (opts.staticModel) {
      resolved = opts.staticModel;
    } else {
      resolved = makeTextOnlyModel('default');
    }
    modelCalls.push({ input, resolved });
    return resolved;
  };

  let tools: ToolService;
  if (opts.realToolPipeline) {
    const approvalRequester: ApprovalRequester = {
      requestApproval: () => ({ id: 'fake-approval-id' }),
    };
    tools = new ToolServiceImpl(
      base.teamStore,
      base.repo,
      approvalRequester,
      conversations,
      goals,
      noopRealtime(),
      {
        delegateAgentTurn: async () => ({ status: 'timed_out', agent: '', agent_id: '', thread_id: '', message_id: '' }),
        getDelegateStatus: async () => ({ status: 'timed_out', agent: '', agent_id: '', thread_id: '', message_id: '' }),
        waitForDelegates: async () => [],
        stopDelegate: async () => ({ stopped: false }),
        readDelegateThread: async () => [],
        sendToDelegate: async () => ({ sent: false, messageId: '' }),
      },
    );
  } else {
    tools = {
      invoke: async (input) =>
        opts.toolInvoke
          ? await opts.toolInvoke(input)
          : { ok: true, output: { status: 'completed', result: 'noop' } },
      allowRun: () => undefined,
    };
  }

  const registry = new ActiveSpiritRegistry();
  const spirits = new SpiritService(base.teamStore, base.repo, noopRealtime(), tools, {
    modelResolver,
    maxIterationsPerRun: 8,
    registry,
    ...(opts.mcpPool ? { mcpPool: opts.mcpPool } : {}),
    ...(opts.mcpResolver ? { mcpResolver: opts.mcpResolver } : {}),
    conversations,
    supervisorDebounceMs: 0,
    supervisorTurnCapPerSession: 3,
  });
  const taskSessions = new TaskSessionService(base.repo, conversations, spirits);

  return {
    archiveRoot: base.archiveRoot,
    repo: base.repo,
    conversations,
    spirits,
    goals,
    taskSessions,
    registry,
    tools,
    organizationId: base.organizationId,
    ownerId: base.ownerId,
    modelCalls,
  };
}
