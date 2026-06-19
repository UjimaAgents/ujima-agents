import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Writable } from 'node:stream';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

type SpawnCodexAppServer = typeof spawn;
const CODEX_APP_SERVER_ARGS = [
  'app-server',
  '--stdio',
  '--disable',
  'apps',
  '--disable',
  'plugins',
  '--disable',
  'plugin_sharing',
  '--disable',
  'browser_use',
  '--disable',
  'browser_use_external',
  '--disable',
  'computer_use',
  '--disable',
  'image_generation',
  '--disable',
  'memories',
];

let spawnCodexAppServer: SpawnCodexAppServer = spawn;
let sharedRpc: Promise<CodexRpc> | undefined;

interface CodexChildProcess {
  stdin: Writable;
  stdout: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

interface CodexAppServerModelOptions {
  modelId: string;
  cwd?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'extra_high';
}

interface CodexStreamHandlers {
  onText(delta: string, id: string): void;
  onToolCall(call: Extract<LanguageModelV3Content, { type: 'tool-call' }>): void;
  onToolResult(result: Extract<LanguageModelV3Content, { type: 'tool-result' }>): void;
}

type CodexRpc = ReturnType<typeof connectCodexAppServer>;
interface CodexUserInput { type: 'text'; text: string; text_elements: [] }
type CodexResponseItem =
  | { type: 'message'; role: string; content: { type: 'input_text' | 'output_text'; text: string }[] }
  | { type: 'function_call'; name: string; arguments: string; call_id: string }
  | { type: 'function_call_output'; call_id: string; output: string };
interface CodexTextItem {
  id: string;
  text: string;
}

const CODEX_DEVELOPER_INSTRUCTIONS = [
  'Use Ujima dynamic tools for workspace actions. Do not use Codex native shell, fs, or file-change tools when a Ujima tool is available.',
  'Your final assistant text is automatically published to the current Ujima conversation.',
  'For a normal answer to the current user or current 1:1 DM, do not call channel.reply, channel.post, channel.dm, channel.handoff, channel.ack, channel.pass, or message. Just return final assistant text.',
  'Use channel/message tools only when the user explicitly asks you to send, post, reply, DM, hand off, acknowledge, pass, or message somewhere as a side effect.',
  'If you use a channel/message tool for that side effect, do not repeat the same body in multiple channel tools or again in final text.',
  'Only call non-posting tools when you need data or need to change the workspace.',
].join('\n');

export function setCodexAppServerSpawn(spawnImpl: SpawnCodexAppServer | undefined): void {
  void sharedRpc?.then((rpc) => rpc.close()).catch(() => undefined);
  sharedRpc = undefined;
  spawnCodexAppServer = spawnImpl ?? spawn;
}

export function createCodexAppServerModel(options: CodexAppServerModelOptions): LanguageModelV3 {
  const rpc = getCodexRpc(options);
  return {
    specificationVersion: 'v3',
    provider: 'openai-codex',
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: (callOptions) => generateWithCodex(options, rpc, callOptions),
    doStream: async (callOptions) => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          let textId: string | undefined;
          try {
            const result = await generateWithCodex(options, rpc, callOptions, {
              onText(delta, id) {
                if (textId !== id) {
                  if (textId) controller.enqueue({ type: 'text-end', id: textId });
                  controller.enqueue({ type: 'text-start', id, providerMetadata: codexTextMetadata(id) });
                  textId = id;
                }
                controller.enqueue({ type: 'text-delta', id, delta, providerMetadata: codexTextMetadata(id) });
              },
              onToolCall(call) {
                if (textId) {
                  controller.enqueue({ type: 'text-end', id: textId, providerMetadata: codexTextMetadata(textId) });
                  textId = undefined;
                }
                controller.enqueue(call);
              },
              onToolResult(result) {
                controller.enqueue(result);
              },
            });
            if (textId) controller.enqueue({ type: 'text-end', id: textId, providerMetadata: codexTextMetadata(textId) });
            controller.enqueue({
              type: 'finish',
              finishReason: result.finishReason,
              usage: result.usage,
            });
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      }),
    }),
  };
}

async function generateWithCodex(
  options: CodexAppServerModelOptions,
  rpcPromise: Promise<CodexRpc>,
  callOptions: LanguageModelV3CallOptions,
  handlers?: CodexStreamHandlers,
): Promise<LanguageModelV3GenerateResult> {
  const rpc = await rpcPromise;
  const allTools = functionTools(callOptions.tools);
  const availableToolNames = new Set(allTools.map((tool) => tool.name));
  const toolNames = new Map(allTools.map((tool) => [codexToolName(tool.name), tool.name]));
  const prompt = splitPrompt(callOptions.prompt);
  const thread = await rpc.request<{ thread: { id: string } }>('thread/start', {
    model: options.modelId,
    cwd: options.cwd ?? process.cwd(),
    ephemeral: true,
    serviceName: 'ujima',
    approvalPolicy: 'untrusted',
    approvalsReviewer: 'user',
    sandbox: 'read-only',
    baseInstructions: prompt.baseInstructions,
    developerInstructions: CODEX_DEVELOPER_INSTRUCTIONS,
    dynamicTools: allTools.map((tool) => ({
      name: codexToolName(tool.name),
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
    })),
  });
  const threadId = thread.thread.id;
  if (prompt.historyItems.length > 0) {
    await rpc.request('thread/inject_items', { threadId, items: prompt.historyItems });
  }
  const state = {
    textItems: [] as CodexTextItem[],
    textItemsById: new Map<string, CodexTextItem>(),
    fallbackTextId: undefined as string | undefined,
    toolCalls: [] as Extract<LanguageModelV3Content, { type: 'tool-call' }>[],
    providerToolParts: [] as LanguageModelV3Content[],
    toolCallIds: new Set<string>(),
    interrupted: false,
    done: false,
    responseId: undefined as string | undefined,
    error: undefined as Error | undefined,
    usage: undefined as LanguageModelV3Usage | undefined,
  };
  const interrupt = (turnId?: string) => {
    const id = turnId ?? state.responseId;
    if (!id || state.interrupted) return;
    state.interrupted = true;
    void rpc.request('turn/interrupt', { threadId, turnId: id }).catch(() => undefined);
  };
  const queueToolCall = (
    call: Extract<LanguageModelV3Content, { type: 'tool-call' }>,
    turnId?: string,
  ) => {
    if (state.toolCallIds.has(call.toolCallId)) return;
    state.toolCallIds.add(call.toolCallId);
    state.toolCalls.push(call);
    handlers?.onToolCall(call);
    interrupt(turnId);
  };
  const offRequest = rpc.onRequest(async (msg) => {
    if (msg.method === 'item/tool/call') {
      const params = msg.params as {
        threadId?: string;
        turnId?: string;
        callId?: string;
        tool?: string;
        namespace?: string | null;
        arguments?: unknown;
      };
      if (params.threadId !== threadId) return;
      const translated = translateCodexToolCall({
        callId: params.callId,
        tool: params.tool,
        namespace: params.namespace,
        args: params.arguments,
        toolNames,
        availableToolNames,
      });
      if (!translated) {
        rpc.respond(msg.id, { contentItems: [{ type: 'input_text', text: 'Invalid tool call' }], success: false });
        return;
      }
      queueToolCall(translated, params.turnId);
      rpc.respond(msg.id, {
        contentItems: [{ type: 'input_text', text: '' }],
        success: true,
      });
      return;
    }
    if (msg.method === 'item/commandExecution/requestApproval') {
      const params = msg.params as {
        threadId?: string;
        turnId?: string;
        itemId?: string;
        command?: string | null;
        cwd?: string | null;
      };
      if (params.threadId !== threadId) return;
      if (params.itemId && params.command && availableToolNames.has('shell')) {
        queueToolCall({
          type: 'tool-call',
          toolCallId: params.itemId,
          toolName: 'shell',
          input: JSON.stringify({ command: params.command, cwd: params.cwd ?? undefined }),
        }, params.turnId);
      }
      rpc.respond(msg.id, { decision: 'decline' });
      return;
    }
    if (msg.method === 'execCommandApproval') {
      const params = msg.params as {
        conversationId?: string;
        callId?: string;
        command?: unknown;
        cwd?: string | null;
      };
      if (params.conversationId !== threadId) return;
      if (params.callId && Array.isArray(params.command) && availableToolNames.has('shell')) {
        queueToolCall({
          type: 'tool-call',
          toolCallId: params.callId,
          toolName: 'shell',
          input: JSON.stringify({
            command: String(params.command[0] ?? ''),
            args: params.command.slice(1).map(String),
            cwd: params.cwd ?? undefined,
          }),
        });
      }
      rpc.respond(msg.id, { decision: 'denied' });
      return;
    }
    if (msg.method === 'item/fileChange/requestApproval') {
      const params = msg.params as {
        threadId?: string;
        turnId?: string;
        itemId?: string;
        callId?: string;
        changes?: unknown;
        fileChanges?: unknown;
        item?: { id?: string; changes?: unknown };
      };
      if (params.threadId !== threadId) return;
      const callId = params.itemId ?? params.callId ?? params.item?.id;
      const call = callId
        ? fileChangeApprovalToolCall(
          callId,
          params.changes ?? params.fileChanges ?? params.item?.changes,
          availableToolNames,
        )
        : null;
      if (call) queueToolCall(call, params.turnId);
      interrupt(params.turnId);
      rpc.respond(msg.id, { decision: 'decline' });
      return;
    }
    if (msg.method === 'applyPatchApproval') {
      const params = msg.params as {
        conversationId?: string;
        callId?: string;
        fileChanges?: Record<string, { type?: string; content?: string; unified_diff?: string; move_path?: string | null }>;
      };
      if (params.conversationId !== threadId) return;
      if (params.callId && params.fileChanges && availableToolNames.has('shell')) {
        queueToolCall({
          type: 'tool-call',
          toolCallId: params.callId,
          toolName: 'shell',
          input: JSON.stringify({ command: applyPatchCommandFromLegacyChanges(params.fileChanges) }),
        });
      }
      rpc.respond(msg.id, { decision: 'denied' });
    }
  });
  const offNotification = rpc.onNotification((msg) => {
    const params = msg.params as { threadId?: string } | undefined;
    if (params?.threadId && params.threadId !== threadId) return;
    if (msg.method === 'item/agentMessage/delta') {
      const deltaParams = msg.params as { itemId?: unknown; delta?: unknown } | undefined;
      const delta = typeof deltaParams?.delta === 'string' ? deltaParams.delta : '';
      const id = typeof deltaParams?.itemId === 'string'
        ? deltaParams.itemId
        : state.fallbackTextId ?? `codex-text-${state.textItems.length + 1}`;
      if (typeof deltaParams?.itemId !== 'string') state.fallbackTextId = id;
      if (delta) appendTextItem(state.textItems, state.textItemsById, id, delta, handlers);
    }
    if (msg.method === 'item/completed') {
      const item = (msg.params as { item?: { type?: string; text?: string; id?: string } } | undefined)?.item;
      if (item?.type === 'agentMessage' && typeof item.text === 'string') {
        const id = item.id ?? state.fallbackTextId ?? `codex-text-${state.textItems.length + 1}`;
        const fallbackItem = state.fallbackTextId ? state.textItemsById.get(state.fallbackTextId) : undefined;
        if (item.id && fallbackItem && !state.textItemsById.has(item.id)) {
          fallbackItem.id = item.id;
          state.textItemsById.set(item.id, fallbackItem);
        }
        completeTextItem(state.textItems, state.textItemsById, id, item.text, handlers);
        if (state.fallbackTextId && state.textItemsById.get(state.fallbackTextId) === state.textItemsById.get(id)) {
          state.textItemsById.delete(state.fallbackTextId);
          state.fallbackTextId = undefined;
        }
        return;
      }
      const translated = translateCodexThreadItem(item, state.toolCallIds);
      if (translated) {
        state.providerToolParts.push(translated.call, translated.result);
        handlers?.onToolCall(translated.call);
        handlers?.onToolResult(translated.result);
      }
    }
    if (msg.method === 'turn/completed') {
      const turn = (msg.params as { turn?: { status?: string; id?: string; error?: { message?: string } } } | undefined)?.turn;
      if (turn?.status === 'failed' && state.toolCalls.length === 0) {
        state.error = new Error(turn.error?.message ?? 'Codex turn failed');
      }
      state.done = true;
      state.responseId = turn?.id;
    }
    if (msg.method === 'thread/tokenUsage/updated') {
      const last = (msg.params as {
        threadId?: string;
        tokenUsage?: {
          last?: {
            inputTokens?: number;
            cachedInputTokens?: number;
            outputTokens?: number;
            reasoningOutputTokens?: number;
          };
        };
      } | undefined)?.tokenUsage?.last;
      if (last && (!params?.threadId || params.threadId === threadId)) {
        state.usage = usageFromCodex(last);
      }
    }
  });
  try {
    const started = await rpc.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: prompt.input,
      cwd: options.cwd ?? process.cwd(),
      effort: codexReasoningEffort(options.reasoningEffort),
    });
    state.responseId = started.turn.id;

    await rpc.waitFor(() => state.done);
    if (state.error) throw state.error;

    const textContent = state.textItems
      .map((item) => ({ id: item.id, text: item.text.trim() }))
      .filter((item) => item.text)
      .map((item) => ({
        type: 'text' as const,
        text: item.text,
        providerMetadata: codexTextMetadata(item.id),
      }));
    return {
      content: [
        ...textContent,
        ...state.providerToolParts,
        ...state.toolCalls,
      ],
      finishReason: state.toolCalls.length > 0
        ? { unified: 'tool-calls', raw: 'tool-calls' }
        : finishReason(textContent.map((item) => item.text).join('')),
      usage: state.usage ?? emptyUsage(),
      response: state.responseId ? { id: state.responseId } : undefined,
      warnings: [],
    };
  } finally {
    offRequest();
    offNotification();
  }
}

async function createCodexRpc(options: CodexAppServerModelOptions): Promise<CodexRpc> {
  const child = spawnCodexAppServer('codex', CODEX_APP_SERVER_ARGS, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  }) as unknown as CodexChildProcess;
  const rpc = connectCodexAppServer(child);
  await rpc.request('initialize', {
    clientInfo: { name: 'ujima', title: 'Ujima', version: '0.0.1' },
    capabilities: { experimentalApi: true },
  });
  rpc.notify('initialized', {});
  return rpc;
}

function getCodexRpc(options: CodexAppServerModelOptions): Promise<CodexRpc> {
  sharedRpc ??= createCodexRpc(options).catch((error) => {
    sharedRpc = undefined;
    throw error;
  });
  return sharedRpc;
}

function functionTools(tools: LanguageModelV3CallOptions['tools']): LanguageModelV3FunctionTool[] {
  return tools?.filter((tool): tool is LanguageModelV3FunctionTool => tool.type === 'function') ?? [];
}

function codexReasoningEffort(
  effort: CodexAppServerModelOptions['reasoningEffort'],
): 'none' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (!effort) return 'none';
  return effort === 'extra_high' ? 'xhigh' : effort;
}

function codexToolName(name: string): string {
  return `ujima_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function codexTextMetadata(id: string) {
  return { ujima: { codexMessageId: id } };
}

function translateCodexToolCall(input: {
  callId?: string;
  tool?: string;
  namespace?: string | null;
  args?: unknown;
  toolNames: Map<string, string>;
  availableToolNames: Set<string>;
}): Extract<LanguageModelV3Content, { type: 'tool-call' }> | null {
  if (!input.callId || !input.tool) return null;
  const directToolName = input.toolNames.get(input.tool);
  if (directToolName) {
    return toolCall(input.callId, directToolName, input.args);
  }

  const native = `${input.namespace ? `${input.namespace}.` : ''}${input.tool}`;
  const normalized = native.replace(/^functions\./, '').replace(/^tool\./, '');
  if ((normalized === 'exec_command' || normalized === 'exec' || normalized === 'shell') && input.availableToolNames.has('shell')) {
    return toolCall(input.callId, 'shell', shellArgs(input.args));
  }
  if ((normalized === 'view' || normalized === 'read_file' || normalized === 'fs.readFile') && input.availableToolNames.has('view')) {
    return toolCall(input.callId, 'view', fileArgs(input.args));
  }
  if ((normalized === 'write_file' || normalized === 'fs.writeFile') && input.availableToolNames.has('write')) {
    return toolCall(input.callId, 'write', writeArgs(input.args));
  }
  if (normalized === 'apply_patch' && input.availableToolNames.has('shell')) {
    return toolCall(input.callId, 'shell', applyPatchArgs(input.args));
  }
  return null;
}

function toolCall(
  toolCallId: string,
  toolName: string,
  args: unknown,
): Extract<LanguageModelV3Content, { type: 'tool-call' }> {
  return {
    type: 'tool-call',
    toolCallId,
    toolName,
    input: stringifyJson(args ?? {}),
  };
}

function shellArgs(args: unknown): Record<string, unknown> {
  const record = objectArgs(args);
  const command = stringArg(record, 'command') ?? stringArg(record, 'cmd') ?? '';
  return {
    command,
    ...(Array.isArray(record.args) ? { args: record.args.map(String) } : {}),
    ...(stringArg(record, 'cwd') ?? stringArg(record, 'workdir') ? { cwd: stringArg(record, 'cwd') ?? stringArg(record, 'workdir') } : {}),
    ...(record.background === true ? { background: true } : {}),
  };
}

function fileArgs(args: unknown): Record<string, unknown> {
  const record = objectArgs(args);
  return { file_path: stringArg(record, 'file_path') ?? stringArg(record, 'path') ?? '' };
}

function writeArgs(args: unknown): Record<string, unknown> {
  const record = objectArgs(args);
  return {
    file_path: stringArg(record, 'file_path') ?? stringArg(record, 'path') ?? '',
    content: stringArg(record, 'content') ?? stringArg(record, 'text') ?? stringArg(record, 'data') ?? '',
  };
}

function applyPatchArgs(args: unknown): Record<string, unknown> {
  const record = objectArgs(args);
  const patch = stringArg(record, 'patch') ?? stringArg(record, 'cmd') ?? stringArg(record, 'input') ?? '';
  return { command: `apply_patch <<'PATCH'\n${patch}\nPATCH` };
}

function translateCodexThreadItem(
  item: unknown,
  clientToolCallIds: Set<string>,
): {
  call: Extract<LanguageModelV3Content, { type: 'tool-call' }>;
  result: Extract<LanguageModelV3Content, { type: 'tool-result' }>;
} | null {
  const record = objectArgs(item);
  const id = stringArg(record, 'id');
  const type = stringArg(record, 'type');
  if (!id || !type || clientToolCallIds.has(id)) return null;

  if (type === 'commandExecution') {
    const command = stringArg(record, 'command') ?? '';
    const cwd = stringArg(record, 'cwd') ?? '.';
    return providerToolPair(id, 'shell', { command, cwd }, {
      status: stringArg(record, 'status') ?? 'completed',
      stdout: stringArg(record, 'aggregatedOutput') ?? '',
      stderr: '',
      exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
      durationMs: typeof record.durationMs === 'number' ? record.durationMs : null,
    }, record.status === 'failed' || record.status === 'declined');
  }

  if (type === 'fileChange') {
    const changes = Array.isArray(record.changes) ? record.changes.map((change) => objectArgs(change)) : [];
    const toolName = changes.length > 1 ? 'multiedit' : fileChangeToolName(changes[0]);
    const args = fileChangeArgs(toolName, changes);
    const diff = changes
      .map((change) => stringArg(change, 'diff'))
      .filter((value): value is string => !!value)
      .join('\n\n');
    return providerToolPair(id, toolName, args, {
      status: stringArg(record, 'status') ?? 'completed',
      diff,
      changes,
    }, record.status === 'failed' || record.status === 'declined');
  }

  if (type === 'mcpToolCall') {
    const server = stringArg(record, 'server') ?? 'mcp';
    const tool = stringArg(record, 'tool') ?? 'tool';
    return providerToolPair(id, `mcp.${server}.${tool}`, objectArgs(record.arguments), {
      status: stringArg(record, 'status') ?? 'completed',
      result: record.result ?? null,
      error: record.error ?? null,
      durationMs: typeof record.durationMs === 'number' ? record.durationMs : null,
    }, record.status === 'failed' || record.error != null);
  }

  if (type === 'dynamicToolCall') {
    const tool = stringArg(record, 'tool') ?? 'tool';
    const namespace = stringArg(record, 'namespace');
    return providerToolPair(id, namespace ? `${namespace}.${tool}` : tool, objectArgs(record.arguments), {
      status: stringArg(record, 'status') ?? 'completed',
      contentItems: record.contentItems ?? null,
      success: record.success ?? null,
      durationMs: typeof record.durationMs === 'number' ? record.durationMs : null,
    }, record.status === 'failed' || record.success === false);
  }

  if (type === 'webSearch') {
    return providerToolPair(id, 'web_search', { query: stringArg(record, 'query') ?? '' }, {
      action: record.action ?? null,
    }, false);
  }

  if (type === 'imageView') {
    return providerToolPair(id, 'view', { file_path: stringArg(record, 'path') ?? '' }, {
      path: stringArg(record, 'path') ?? '',
    }, false);
  }

  if (type === 'imageGeneration') {
    return providerToolPair(id, 'image_generation', {
      prompt: stringArg(record, 'revisedPrompt') ?? '',
    }, {
      status: stringArg(record, 'status') ?? '',
      result: stringArg(record, 'result') ?? '',
      savedPath: stringArg(record, 'savedPath'),
    }, record.status === 'failed');
  }

  if (type === 'collabAgentToolCall') {
    return providerToolPair(id, 'agent.delegate', {
      tool: stringArg(record, 'tool') ?? '',
      prompt: stringArg(record, 'prompt') ?? '',
      model: stringArg(record, 'model'),
    }, {
      status: stringArg(record, 'status') ?? '',
      receiverThreadIds: Array.isArray(record.receiverThreadIds) ? record.receiverThreadIds : [],
      agentsStates: record.agentsStates ?? {},
    }, record.status === 'failed');
  }

  return null;
}

function providerToolPair(
  toolCallId: string,
  toolName: string,
  args: unknown,
  result: unknown,
  isError: boolean,
): {
  call: Extract<LanguageModelV3Content, { type: 'tool-call' }>;
  result: Extract<LanguageModelV3Content, { type: 'tool-result' }>;
} {
  return {
    call: {
      ...toolCall(toolCallId, toolName, args),
      providerExecuted: true,
      dynamic: true,
    },
    result: {
      type: 'tool-result',
      toolCallId,
      toolName,
      result: jsonValue(result),
      isError,
      dynamic: true,
    },
  };
}

function fileChangeToolName(change: Record<string, unknown> | undefined): string {
  const kind = objectArgs(change?.kind);
  return kind.type === 'add' ? 'write' : 'edit';
}

function fileChangeApprovalToolCall(
  toolCallId: string,
  rawChanges: unknown,
  availableToolNames: Set<string>,
): Extract<LanguageModelV3Content, { type: 'tool-call' }> | null {
  const changes = normalizeFileChanges(rawChanges);
  if (changes.length === 0) return null;
  const direct = executableFileChangeTool(changes, availableToolNames);
  if (direct) return toolCall(toolCallId, direct.toolName, direct.args);
  if (availableToolNames.has('shell')) {
    return toolCall(toolCallId, 'shell', { command: applyPatchCommandFromFileChanges(changes) });
  }
  return null;
}

function executableFileChangeTool(
  changes: Record<string, unknown>[],
  availableToolNames: Set<string>,
): { toolName: string; args: Record<string, unknown> } | null {
  if (changes.length === 1) {
    const change = changes[0] ?? {};
    const path = changePath(change);
    const kind = changeKind(change);
    const oldString = changeOldString(change);
    const newString = changeNewString(change);
    if (kind === 'add' && path && newString !== undefined && availableToolNames.has('write')) {
      return { toolName: 'write', args: { file_path: path, content: newString } };
    }
    if (kind !== 'delete' && path && oldString && newString !== undefined && availableToolNames.has('edit')) {
      return { toolName: 'edit', args: { file_path: path, old_string: oldString, new_string: newString } };
    }
  }

  const firstPath = changePath(changes[0] ?? {});
  const edits = changes.map((change) => ({
    old_string: changeOldString(change) ?? '',
    new_string: changeNewString(change) ?? '',
  }));
  if (
    firstPath &&
    changes.every((change) => changePath(change) === firstPath && changeKind(change) !== 'delete') &&
    edits.every((edit) => edit.old_string && edit.new_string) &&
    availableToolNames.has('multiedit')
  ) {
    return { toolName: 'multiedit', args: { file_path: firstPath, edits } };
  }
  return null;
}

function fileChangeArgs(toolName: string, changes: Record<string, unknown>[]): Record<string, unknown> {
  if (toolName === 'write') {
    const first = changes[0] ?? {};
    return {
      file_path: stringArg(first, 'path') ?? '',
      content: stringArg(first, 'diff') ?? '',
    };
  }
  if (toolName === 'edit') {
    const first = changes[0] ?? {};
    return {
      file_path: stringArg(first, 'path') ?? '',
      old_string: '',
      new_string: stringArg(first, 'diff') ?? '',
    };
  }
  const firstPath = stringArg(changes[0] ?? {}, 'path') ?? '';
  return {
    file_path: firstPath,
    edits: changes.map((change) => ({
      old_string: '',
      new_string: `${stringArg(change, 'path') ?? firstPath}\n${stringArg(change, 'diff') ?? ''}`.trim(),
    })),
  };
}

function normalizeFileChanges(rawChanges: unknown): Record<string, unknown>[] {
  if (Array.isArray(rawChanges)) return rawChanges.map((change) => objectArgs(change)).filter((change) => Object.keys(change).length > 0);
  const record = objectArgs(rawChanges);
  return Object.entries(record).map(([path, change]) => ({ path, ...objectArgs(change) }));
}

function changeKind(change: Record<string, unknown>): string {
  const kind = objectArgs(change.kind);
  return stringArg(kind, 'type') ?? stringArg(change, 'type') ?? 'update';
}

function changePath(change: Record<string, unknown>): string | undefined {
  return stringArg(change, 'path') ?? stringArg(change, 'file_path') ?? stringArg(change, 'filePath');
}

function changeOldString(change: Record<string, unknown>): string | undefined {
  return stringArg(change, 'old_string') ??
    stringArg(change, 'oldString') ??
    stringArg(change, 'oldText') ??
    stringArg(change, 'before');
}

function changeNewString(change: Record<string, unknown>): string | undefined {
  return stringArg(change, 'new_string') ??
    stringArg(change, 'newString') ??
    stringArg(change, 'newText') ??
    stringArg(change, 'after') ??
    stringArg(change, 'content');
}

function applyPatchCommandFromFileChanges(changes: Record<string, unknown>[]): string {
  const patch = changes
    .map((change) => {
      const directPatch = stringArg(change, 'patch') ?? stringArg(change, 'diff') ?? stringArg(change, 'unified_diff');
      if (directPatch?.includes('*** Begin Patch')) return directPatch;
      const path = changePath(change);
      if (!path) return directPatch ?? '';
      const kind = changeKind(change);
      if (kind === 'add') return `*** Add File: ${path}\n${(changeNewString(change) ?? '').split('\n').map((line) => `+${line}`).join('\n')}`;
      if (kind === 'delete') return `*** Delete File: ${path}`;
      const oldString = changeOldString(change);
      const newString = changeNewString(change);
      if (oldString !== undefined && newString !== undefined) {
        return `*** Update File: ${path}\n@@\n${oldString.split('\n').map((line) => `-${line}`).join('\n')}\n${newString.split('\n').map((line) => `+${line}`).join('\n')}`;
      }
      return directPatch ?? '';
    })
    .filter(Boolean)
    .join('\n');
  return patch.includes('*** Begin Patch')
    ? `apply_patch <<'PATCH'\n${patch}\nPATCH`
    : `apply_patch <<'PATCH'\n*** Begin Patch\n${patch}\n*** End Patch\nPATCH`;
}

function applyPatchCommandFromLegacyChanges(
  changes: Record<string, { type?: string; content?: string; unified_diff?: string; move_path?: string | null }>,
): string {
  const patch = Object.entries(changes)
    .map(([path, change]) => {
      if (change.type === 'update') return change.unified_diff ?? '';
      if (change.type === 'add') return `*** Begin Patch\n*** Add File: ${path}\n${(change.content ?? '').split('\n').map((line) => `+${line}`).join('\n')}\n*** End Patch`;
      if (change.type === 'delete') return `*** Begin Patch\n*** Delete File: ${path}\n*** End Patch`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
  return `apply_patch <<'PATCH'\n${patch}\nPATCH`;
}

function jsonValue(value: unknown): NonNullable<Extract<LanguageModelV3Content, { type: 'tool-result' }>['result']> {
  if (value === undefined || value === null) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as NonNullable<Extract<LanguageModelV3Content, { type: 'tool-result' }>['result']>;
  } catch {
    return String(value);
  }
}

function objectArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
}

function stringArg(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function appendTextItem(
  items: CodexTextItem[],
  byId: Map<string, CodexTextItem>,
  id: string,
  delta: string,
  handlers?: CodexStreamHandlers,
): void {
  const item = getTextItem(items, byId, id);
  item.text += delta;
  handlers?.onText(delta, id);
}

function completeTextItem(
  items: CodexTextItem[],
  byId: Map<string, CodexTextItem>,
  id: string,
  text: string,
  handlers?: CodexStreamHandlers,
): void {
  const item = byId.get(id) ?? (items.length === 1 ? items[0] : undefined) ?? getTextItem(items, byId, id);
  byId.set(id, item);
  if (text.startsWith(item.text)) {
    const delta = text.slice(item.text.length);
    if (delta) handlers?.onText(delta, id);
  } else if (!item.text && text) {
    handlers?.onText(text, id);
  }
  item.text = text;
}

function getTextItem(items: CodexTextItem[], byId: Map<string, CodexTextItem>, id: string): CodexTextItem {
  let item = byId.get(id);
  if (!item) {
    item = { id, text: '' };
    byId.set(id, item);
    items.push(item);
  }
  return item;
}

function finishReason(text: string): LanguageModelV3FinishReason {
  return { unified: text ? 'stop' : 'other', raw: text ? 'completed' : undefined };
}

function splitPrompt(prompt: LanguageModelV3Prompt): {
  baseInstructions: string;
  historyItems: CodexResponseItem[];
  input: CodexUserInput[];
} {
  const system = prompt.filter((message) => message.role === 'system');
  const messages = prompt.filter((message) => message.role !== 'system');
  const current = messages.at(-1);
  const history = current ? messages.slice(0, -1) : [];
  const historyItems = promptToResponseItems(history);
  let input = current ? messageToInput(current) : [];
  if (current?.role === 'tool') {
    historyItems.push(...promptToResponseItems([current]));
    input = textInput('Continue.');
  }
  return {
    baseInstructions: system.map((message) => message.content).join('\n\n') ||
      'Follow the supplied instructions and use available Ujima tools when needed.',
    historyItems,
    input: input.length > 0 ? input : textInput('Continue.'),
  };
}

function promptToResponseItems(prompt: LanguageModelV3Prompt): CodexResponseItem[] {
  return prompt.flatMap((message) => {
    if (message.role === 'system') return [];
    if (message.role === 'user') {
      return textResponseItem('user', contentText(message));
    }
    if (message.role === 'assistant') {
      const items: CodexResponseItem[] = [];
      const text = contentText(message, ['text', 'reasoning']);
      if (text) items.push(...textResponseItem('assistant', text));
      for (const part of message.content) {
        if (part.type === 'tool-call') {
          items.push({
            type: 'function_call',
            name: codexToolName(part.toolName),
            arguments: stringifyJson(part.input ?? {}),
            call_id: part.toolCallId,
          });
        }
        if (part.type === 'tool-result') {
          items.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output: toolResultText(toolResultPayload(part)),
          });
        }
      }
      return items;
    }
    return message.content.flatMap((part) =>
      part.type === 'tool-result'
        ? [{ type: 'function_call_output' as const, call_id: part.toolCallId, output: toolResultText(toolResultPayload(part)) }]
        : [],
    );
  });
}

function textResponseItem(role: string, text: string): CodexResponseItem[] {
  return text ? [{ type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] }] : [];
}

function messageToInput(message: LanguageModelV3Message): CodexUserInput[] {
  const text = contentText(message);
  return text ? textInput(text) : [];
}

function textInput(text: string): CodexUserInput[] {
  return [{ type: 'text', text, text_elements: [] }];
}

function contentText(message: LanguageModelV3Message, allowed = ['text']): string {
  if (message.role === 'system') return message.content;
  return message.content
    .flatMap((part) => {
      if (allowed.includes(part.type) && 'text' in part && typeof part.text === 'string') return [part.text];
      return [];
    })
    .join('\n');
}

function toolResultPayload(part: LanguageModelV3ToolResultPart | { output?: unknown; result?: unknown }): unknown {
  const record = part as { output?: unknown; result?: unknown };
  return Object.prototype.hasOwnProperty.call(record, 'output') ? record.output : record.result;
}

function toolResultText(output: unknown): string {
  if (typeof output === 'string') return output;
  const record = objectArgs(output);
  const type = stringArg(record, 'type');
  if ((type === 'text' || type === 'error-text') && typeof record.value === 'string') return record.value;
  if (type === 'json' || type === 'error-json') return stringifyJson(record.value);
  if (type === 'execution-denied') return stringArg(record, 'reason') ?? 'Execution denied.';
  if (type === 'content' && Array.isArray(record.value)) {
    return record.value
      .map((item) => {
        const content = objectArgs(item);
        return content.type === 'text' && typeof content.text === 'string' ? content.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return stringifyJson(output);
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function usageFromCodex(last: {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: last.inputTokens,
      noCache: last.inputTokens !== undefined && last.cachedInputTokens !== undefined
        ? Math.max(last.inputTokens - last.cachedInputTokens, 0)
        : last.inputTokens,
      cacheRead: last.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: last.outputTokens,
      text: last.outputTokens !== undefined && last.reasoningOutputTokens !== undefined
        ? Math.max(last.outputTokens - last.reasoningOutputTokens, 0)
        : last.outputTokens,
      reasoning: last.reasoningOutputTokens,
    },
    raw: last,
  };
}

function emptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function connectCodexAppServer(child: CodexChildProcess) {
  const listeners = new Set<(message: JsonRpcMessage) => void>();
  const requestListeners = new Set<(message: JsonRpcMessage) => void | Promise<void>>();
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let closed = false;
  const rl = createInterface({ input: child.stdout });

  const notify = (message: JsonRpcMessage) => {
    for (const listener of listeners) listener(message);
  };

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (message.method && message.id !== undefined) {
      for (const listener of requestListeners) void listener(message);
    } else if (typeof message.id === 'number') {
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if ('error' in message && message.error) {
          waiter.reject(new Error(message.error.message ?? 'Codex app-server error'));
        } else {
          waiter.resolve(message.result);
        }
      }
    } else if (message.method) {
      notify(message);
    }
  });

  child.on('close', () => {
    closed = true;
    for (const waiter of pending.values()) waiter.reject(new Error('Codex app-server exited'));
    pending.clear();
  });

  child.on('error', (error) => {
    for (const waiter of pending.values()) waiter.reject(error instanceof Error ? error : new Error(String(error)));
    pending.clear();
  });

  return {
    request<T>(method: string, params: unknown): Promise<T> {
      if (closed) return Promise.reject(new Error('Codex app-server already closed'));
      const id = nextId++;
      const promise = new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as unknown as (value: unknown) => void, reject });
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, id, params })}\n`);
      return promise;
    },
    notify(method: string, params: unknown): void {
      if (!closed) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    onNotification(listener: (message: JsonRpcMessage) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onRequest(listener: (message: JsonRpcMessage) => void | Promise<void>): () => void {
      requestListeners.add(listener);
      return () => requestListeners.delete(listener);
    },
    respond(id: JsonRpcMessage['id'], result: unknown): void {
      if (!closed && id !== undefined) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
      }
    },
    waitFor(predicate: () => boolean): Promise<void> {
      if (predicate()) return Promise.resolve();
      return new Promise((resolve) => {
        const listener = () => {
          if (predicate()) {
            listeners.delete(listener);
            resolve();
          }
        };
        listeners.add(listener);
      });
    },
    close(): void {
      closed = true;
      rl.close();
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
  };
}
