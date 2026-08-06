import type * as ClaudeAgentSdkModule from '@anthropic-ai/claude-agent-sdk';
import type {
  query,
  Options as ClaudeCodeSdkOptions,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

export type ClaudeCodeToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  toolCallId: string,
) => Promise<unknown>;

export interface ClaudeCodeModelOptions {
  modelId: string;
  cwd?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'extra_high';
  toolExecutor?: ClaudeCodeToolExecutor;
  queryImpl?: typeof query;
}

type ClaudeAgentSdk = typeof ClaudeAgentSdkModule;

function loadClaudeAgentSdk(): Promise<ClaudeAgentSdk> {
  return import('@anthropic-ai/claude-agent-sdk');
}

interface RawMessage {
  type?: string;
  message?: { content?: unknown; [key: string]: unknown };
  tool_use_result?: unknown;
  usage?: unknown;
  result?: string;
  is_error?: boolean;
  error?: string;
  stop_reason?: string | null;
}

interface Collected {
  content: LanguageModelV2Content[];
  usage: LanguageModelV2Usage;
  stopReason?: string | null;
}

const MCP_SERVER_NAME = 'ujima';
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return stringify(value);
  return value.map((part) => {
    const record = asRecord(part);
    if (!record) return stringify(part);
    if (record.type === 'text' || record.type === 'reasoning') return String(record.text ?? '');
    if (record.type === 'tool-call') {
      return `[tool call ${String(record.toolName)}: ${stringify(record.input)}]`;
    }
    if (record.type === 'tool-result') {
      return `[tool result ${String(record.toolName)}: ${stringify(record.output)}]`;
    }
    return `[${String(record.type ?? 'content')}]`;
  }).filter(Boolean).join('\n');
}

function promptParts(prompt: LanguageModelV2Prompt): { system?: string; prompt: string } {
  const system: string[] = [];
  const transcript: string[] = [];
  for (const message of prompt) {
    if (message.role === 'system') {
      system.push(message.content);
      continue;
    }
    transcript.push(`${message.role.toUpperCase()}:\n${contentText(message.content)}`);
  }
  return {
    system: system.length > 0 ? system.join('\n\n') : undefined,
    prompt: transcript.join('\n\n') || 'Respond to the user.',
  };
}

function schemaType(schema: Record<string, unknown> | undefined): z.ZodTypeAny {
  if (!schema) return z.unknown();
  const type = schema.type;
  let result: z.ZodTypeAny;
  if (Array.isArray(schema.enum) && schema.enum.every((value) => typeof value === 'string')) {
    const values = schema.enum as string[];
    result = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
  } else if (type === 'string') result = z.string();
  else if (type === 'number' || type === 'integer') result = z.number();
  else if (type === 'boolean') result = z.boolean();
  else if (type === 'array') result = z.array(schemaType(asRecord(schema.items) ?? undefined));
  else if (type === 'object' || schema.properties) result = z.record(z.string(), z.unknown());
  else result = z.unknown();

  if (typeof schema.description === 'string') result = result.describe(schema.description);
  if (schema.nullable === true) result = result.nullable();
  return result;
}

function schemaShape(inputSchema: unknown): Record<string, z.ZodTypeAny> {
  const schema = asRecord(inputSchema);
  const properties = asRecord(schema?.properties);
  if (!properties) return {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((value): value is string => typeof value === 'string') : []);
  return Object.fromEntries(Object.entries(properties).map(([name, value]) => {
    const field = schemaType(asRecord(value) ?? undefined);
    return [name, required.has(name) ? field : field.optional()];
  }));
}

function toolNameFromSdk(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}

function buildMcpServer(
  tools: NonNullable<LanguageModelV2CallOptions['tools']>,
  executor: ClaudeCodeToolExecutor,
  sdk: ClaudeAgentSdk,
) {
  interface FunctionTool { type: 'function'; name: string; description?: string; inputSchema: unknown }
  type SdkToolFactory = (
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>,
    extras?: { alwaysLoad?: boolean },
  ) => unknown;
  const makeSdkTool = sdk.tool as unknown as SdkToolFactory;
  const definitions = (tools.filter((item) => item.type === 'function') as FunctionTool[]).map((item) => makeSdkTool(
      item.name,
      item.description ?? item.name,
      schemaShape(item.inputSchema),
      async (args, extra) => {
        const extraRecord = asRecord(extra);
        const toolCallId = typeof extraRecord?.toolUseId === 'string'
          ? extraRecord.toolUseId
          : `${item.name}-${Date.now()}`;
        try {
          const result = await executor(item.name, asRecord(args) ?? {}, toolCallId);
          return { content: [{ type: 'text' as const, text: stringify(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{
              type: 'text' as const,
              text: error instanceof Error ? error.message : String(error),
            }],
          };
        }
      },
      { alwaysLoad: true },
    ));

  return definitions.length > 0
    ? sdk.createSdkMcpServer({ name: MCP_SERVER_NAME, version: '1.0.0', alwaysLoad: true, tools: definitions as never })
    : undefined;
}

function usageFrom(value: unknown): LanguageModelV2Usage {
  const usage = asRecord(value) ?? {};
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
  const cachedInputTokens = Number(usage.cache_read_input_tokens ?? usage.cachedInputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
  };
}

function emitToolResult(
  content: LanguageModelV2Content[],
  value: unknown,
  toolNames: Map<string, string>,
): void {
  const result = asRecord(value);
  if (!result) return;
  const toolCallId = String(result.tool_use_id ?? result.toolUseId ?? '');
  if (!toolCallId) return;
  content.push({
    type: 'tool-result',
    toolCallId,
    toolName: toolNames.get(toolCallId) ?? toolNameFromSdk(String(result.tool_name ?? 'tool')),
    result: result.content ?? result.output ?? result,
    ...(result.is_error === true ? { isError: true } : {}),
    providerExecuted: true,
  });
}

function collectSdkMessage(
  message: RawMessage,
  content: LanguageModelV2Content[],
  toolNames: Map<string, string>,
): { usage?: LanguageModelV2Usage; stopReason?: string | null } {
  if (message.type === 'assistant') {
    if (message.error) throw new Error(`Claude Code ${message.error}`);
    const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
    for (const block of blocks) {
      const record = asRecord(block);
      if (!record) continue;
      if (record.type === 'text' && typeof record.text === 'string') {
        content.push({ type: 'text', text: record.text });
      } else if (record.type === 'thinking' && typeof record.thinking === 'string') {
        content.push({ type: 'reasoning', text: record.thinking });
      } else if (record.type === 'tool_use') {
        const id = String(record.id ?? `${record.name}-${content.length}`);
        const name = toolNameFromSdk(String(record.name ?? 'tool'));
        toolNames.set(id, name);
        content.push({ type: 'tool-call', toolCallId: id, toolName: name, input: stringify(record.input ?? {}), providerExecuted: true });
      } else if (record.type === 'tool_result') {
        emitToolResult(content, { ...record, tool_use_id: record.tool_use_id }, toolNames);
      }
    }
  } else if (message.type === 'user') {
    const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
    for (const block of blocks) {
      if (asRecord(block)?.type === 'tool_result') emitToolResult(content, block, toolNames);
    }
    if (blocks.length === 0) emitToolResult(content, message.tool_use_result, toolNames);
  } else if (message.type === 'result') {
    if (message.is_error) throw new Error(message.result || message.error || 'Claude Code query failed');
    return { usage: usageFrom(message.usage), stopReason: message.stop_reason };
  }
  return {};
}

function claudeEnvironment(): Record<string, string | undefined> {
  const env = { ...process.env };
  const configuredHome = process.env.CLAUDE_CODE_HOME?.trim();
  if (configuredHome) {
    env.CLAUDE_CONFIG_DIR = configuredHome;
  }
  return env;
}

function effortForSdk(effort: ClaudeCodeModelOptions['reasoningEffort']): ClaudeCodeSdkOptions['effort'] | undefined {
  if (!effort || effort === 'none') return undefined;
  return (effort === 'extra_high' ? 'xhigh' : effort) as ClaudeCodeSdkOptions['effort'];
}

async function collectQuery(
  options: ClaudeCodeModelOptions,
  params: LanguageModelV2CallOptions,
): Promise<Collected> {
  const parts = promptParts(params.prompt);
  const sdk = await loadClaudeAgentSdk();
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  if (params.abortSignal?.aborted) abortController.abort();
  else params.abortSignal?.addEventListener('abort', onAbort, { once: true });

  const mcpServer = options.toolExecutor && params.tools
    ? buildMcpServer(params.tools, options.toolExecutor, sdk)
    : undefined;
  const mcpToolNames = (params.tools ?? [])
    .filter((item): item is Extract<typeof item, { type: 'function' }> => item.type === 'function')
    .map((item) => `${MCP_TOOL_PREFIX}${item.name}`);
  const sdkOptions: ClaudeCodeSdkOptions = {
    model: options.modelId,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(parts.system ? { systemPrompt: parts.system } : {}),
    ...(effortForSdk(options.reasoningEffort) ? { effort: effortForSdk(options.reasoningEffort) } : {}),
    includePartialMessages: false,
    abortController,
    env: claudeEnvironment(),
    tools: [],
    allowedTools: mcpToolNames,
    strictMcpConfig: true,
    ...(mcpServer ? { mcpServers: { [MCP_SERVER_NAME]: mcpServer } } : {}),
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 100,
  };

  try {
    const content: LanguageModelV2Content[] = [];
    const toolNames = new Map<string, string>();
    let usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let stopReason: string | null | undefined;
    const run = (options.queryImpl ?? sdk.query)({ prompt: parts.prompt, options: sdkOptions });
    for await (const message of run as AsyncIterable<RawMessage>) {
      const result = collectSdkMessage(message, content, toolNames);
      if (result.usage) usage = result.usage;
      if (result.stopReason !== undefined) stopReason = result.stopReason;
    }
    return { content, usage, stopReason };
  } finally {
    params.abortSignal?.removeEventListener('abort', onAbort);
  }
}

function streamFor(output: Collected): ReadableStream<LanguageModelV2StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      let textIndex = 0;
      for (const part of output.content) {
        if (part.type === 'text') {
          const id = `text-${textIndex++}`;
          controller.enqueue({ type: 'text-start', id });
          controller.enqueue({ type: 'text-delta', id, delta: part.text });
          controller.enqueue({ type: 'text-end', id });
        } else if (part.type === 'reasoning') {
          const id = `reasoning-${textIndex++}`;
          controller.enqueue({ type: 'reasoning-start', id });
          controller.enqueue({ type: 'reasoning-delta', id, delta: part.text });
          controller.enqueue({ type: 'reasoning-end', id });
        } else if (part.type === 'tool-call') {
          controller.enqueue(part);
        } else if (part.type === 'tool-result') {
          controller.enqueue(part);
        }
      }
      controller.enqueue({ type: 'finish', finishReason: 'stop', usage: output.usage });
      controller.close();
    },
  });
}

export function createClaudeCodeModel(options: ClaudeCodeModelOptions): LanguageModel {
  const model = {
    specificationVersion: 'v2' as const,
    provider: 'anthropic.claude-code',
    modelId: options.modelId,
    supportedUrls: {},
    __claudeCodeOptions: options,

    async doGenerate(params: LanguageModelV2CallOptions) {
      try {
        const output = await collectQuery(options, params);
        return {
          content: output.content,
          finishReason: 'stop' as const,
          usage: output.usage,
          warnings: [],
          request: { body: { model: options.modelId } },
          response: { modelId: options.modelId, timestamp: new Date() },
        };
      } catch (error) {
        throw new Error(`Claude Code SDK error: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async doStream(params: LanguageModelV2CallOptions) {
      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          void collectQuery(options, params).then((output) => {
            const body = streamFor(output);
            void (async () => {
              const reader = body.getReader();
              try {
                while (true) {
                  const next = await reader.read();
                  if (next.done) break;
                  if (next.value.type !== 'stream-start') controller.enqueue(next.value);
                }
                controller.close();
              } finally {
                reader.releaseLock();
              }
            })();
          }).catch((error) => {
            controller.enqueue({ type: 'error', error: new Error(`Claude Code SDK stream error: ${error instanceof Error ? error.message : String(error)}`) });
            controller.close();
          });
        },
      });
      return { stream, request: { body: { model: options.modelId } } };
    },
  };

  return model as unknown as LanguageModel;
}

export function configureClaudeCodeTools(
  model: LanguageModel,
  toolExecutor: ClaudeCodeToolExecutor,
): LanguageModel {
  const options = (model as LanguageModel & { __claudeCodeOptions?: ClaudeCodeModelOptions }).__claudeCodeOptions;
  return options ? createClaudeCodeModel({ ...options, toolExecutor }) : model;
}
