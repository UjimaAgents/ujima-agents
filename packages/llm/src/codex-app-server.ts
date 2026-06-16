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
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

type SpawnCodexAppServer = typeof spawn;
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
  onText(delta: string): void;
  onToolCall(call: Extract<LanguageModelV3Content, { type: 'tool-call' }>): void;
}

type CodexRpc = ReturnType<typeof connectCodexAppServer>;

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
          let textStarted = false;
          try {
            const result = await generateWithCodex(options, rpc, callOptions, {
              onText(delta) {
                if (!textStarted) {
                  controller.enqueue({ type: 'text-start', id: 'codex-text' });
                  textStarted = true;
                }
                controller.enqueue({ type: 'text-delta', id: 'codex-text', delta });
              },
              onToolCall(call) {
                if (textStarted) {
                  controller.enqueue({ type: 'text-end', id: 'codex-text' });
                  textStarted = false;
                }
                controller.enqueue(call);
              },
            });
            if (textStarted) controller.enqueue({ type: 'text-end', id: 'codex-text' });
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
  const tools = functionTools(callOptions.tools);
  const toolNames = new Map(tools.map((tool) => [codexToolName(tool.name), tool.name]));
  const thread = await rpc.request<{ thread: { id: string } }>('thread/start', {
    model: options.modelId,
    cwd: options.cwd ?? process.cwd(),
    ephemeral: true,
    baseInstructions: 'Follow the supplied instructions and use available Ujima tools when needed.',
    developerInstructions: promptToText(callOptions.prompt.slice(0, -1)),
    dynamicTools: tools.map((tool) => ({
      name: codexToolName(tool.name),
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
    })),
  });
  const threadId = thread.thread.id;
  const prompt = promptToText(callOptions.prompt.slice(-1));
  const state = {
    text: '',
    toolCalls: [] as Extract<LanguageModelV3Content, { type: 'tool-call' }>[],
    done: false,
    responseId: undefined as string | undefined,
    error: undefined as Error | undefined,
  };
  const offRequest = rpc.onRequest(async (msg) => {
    if (msg.method !== 'item/tool/call') return;
    const params = msg.params as { threadId?: string; callId?: string; tool?: string; arguments?: unknown };
    if (params.threadId !== threadId) return;
    if (!params.callId || !params.tool) {
      rpc.respond(msg.id, { contentItems: [{ type: 'inputText', text: 'Invalid tool call' }], success: false });
      return;
    }
    const call = {
      type: 'tool-call',
      toolCallId: params.callId,
      toolName: toolNames.get(params.tool) ?? params.tool,
      input: JSON.stringify(params.arguments ?? {}),
    } as const;
    state.toolCalls.push(call);
    handlers?.onToolCall(call);
    rpc.respond(msg.id, {
      contentItems: [{ type: 'inputText', text: 'Tool call delegated to Ujima.' }],
      success: true,
    });
    if (state.responseId) {
      await rpc.request('turn/interrupt', { threadId, turnId: state.responseId }).catch(() => undefined);
    }
  });
  const offNotification = rpc.onNotification((msg) => {
    const params = msg.params as { threadId?: string } | undefined;
    if (params?.threadId && params.threadId !== threadId) return;
    if (msg.method === 'item/agentMessage/delta') {
      const delta = typeof (msg.params as { delta?: unknown } | undefined)?.delta === 'string'
        ? ((msg.params as { delta: string }).delta)
        : '';
      state.text += delta;
      if (delta) handlers?.onText(delta);
    }
    if (msg.method === 'item/completed') {
      const item = (msg.params as { item?: { type?: string; text?: string; id?: string } } | undefined)?.item;
      if (item?.type === 'agentMessage' && typeof item.text === 'string') {
        if (!state.text && item.text) handlers?.onText(item.text);
        state.text = item.text;
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
  });
  try {
    const started = await rpc.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      cwd: options.cwd ?? process.cwd(),
      effort: codexReasoningEffort(options.reasoningEffort),
    });
    state.responseId = started.turn.id;

    await rpc.waitFor(() => state.done);
    if (state.error) throw state.error;

    return {
      content: [
        ...(state.text ? [{ type: 'text' as const, text: state.text }] : []),
        ...state.toolCalls,
      ],
      finishReason: state.toolCalls.length > 0
        ? { unified: 'tool-calls', raw: 'tool-calls' }
        : finishReason(state.text),
      usage: emptyUsage(),
      response: state.responseId ? { id: state.responseId } : undefined,
      warnings: [],
    };
  } finally {
    offRequest();
    offNotification();
  }
}

async function createCodexRpc(options: CodexAppServerModelOptions): Promise<CodexRpc> {
  const child = spawnCodexAppServer('codex', ['app-server', '--stdio'], {
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
  return effort === 'extra_high' ? 'xhigh' : effort;
}

function codexToolName(name: string): string {
  return `ujima_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function finishReason(text: string): LanguageModelV3FinishReason {
  return { unified: text ? 'stop' : 'other', raw: text ? 'completed' : undefined };
}

function emptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function promptToText(prompt: LanguageModelV3Prompt): string {
  return prompt.map((message) => {
    const content = Array.isArray(message.content)
      ? message.content.map((part) => {
          if (part.type === 'text') return part.text;
          if (part.type === 'reasoning') return part.text;
          return JSON.stringify(part);
        }).join('\n')
      : String(message.content);
    return `${message.role}: ${content}`;
  }).join('\n\n');
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
