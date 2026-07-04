import {
  APICallError,
  type JSONSchema7,
  type JSONValue,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Content,
  type LanguageModelV3FilePart,
  type LanguageModelV3FunctionTool,
  type LanguageModelV3GenerateResult,
  type LanguageModelV3TextPart,
  type LanguageModelV3ProviderTool,
  type LanguageModelV3ReasoningPart,
  type LanguageModelV3StreamPart,
  type LanguageModelV3StreamResult,
  type LanguageModelV3ToolCallPart,
  type LanguageModelV3ToolChoice,
  type LanguageModelV3ToolResultOutput,
  type LanguageModelV3ToolResultPart,
  type LanguageModelV3Usage,
  type SharedV3ProviderMetadata,
  type SharedV3Warning,
} from '@ai-sdk/provider';
import type {
  OpenAIResponsesAnnotation,
  OpenAIResponsesInputItem,
  OpenAIResponsesOutputItem,
  OpenAIResponsesProviderOptions,
  OpenAIResponsesRequest,
  OpenAIResponsesResponse,
  OpenAIResponsesStreamEvent,
  OpenAIResponsesTool,
  OpenAIResponsesUserContentPart,
  OpenAIResponsesUsage,
} from './openai-responses-api-types.js';

interface OpenAIResponsesLanguageModelOptions {
  fetch: typeof fetch;
  provider?: string;
  preserveItemIds?: boolean;
  supportsMaxOutputTokens?: boolean;
  url?: string;
}

const DEFAULT_URL = 'https://chatgpt.com/backend-api/codex/responses';
const PROVIDER_NAME = 'openai.responses';

export class OpenAIResponsesLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {
    'image/*': [/^https?:\/\/.*$/],
    'application/pdf': [/^https?:\/\/.*$/],
  };

  private readonly fetchFn: typeof fetch;
  private readonly preserveItemIds: boolean;
  private readonly supportsMaxOutputTokens: boolean;
  private readonly url: string;

  constructor(modelId: string, options: OpenAIResponsesLanguageModelOptions) {
    this.modelId = modelId;
    this.fetchFn = options.fetch;
    this.preserveItemIds = options.preserveItemIds ?? true;
    this.supportsMaxOutputTokens = options.supportsMaxOutputTokens ?? true;
    this.url = options.url ?? DEFAULT_URL;
    this.provider = options.provider ?? PROVIDER_NAME;
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const prepared = prepareRequestBody(
      this.modelId,
      options,
      false,
      this.supportsMaxOutputTokens,
      this.preserveItemIds,
    );
    const response = await this.fetchFn(this.url, {
      method: 'POST',
      headers: requestHeaders(options.headers),
      body: JSON.stringify(prepared.body),
      signal: options.abortSignal,
    });
    const headers = responseHeadersRecord(response);
    const rawText = await response.text();
    if (!response.ok) {
      throw apiError({
        message: extractResponseMessage(rawText) ?? `${response.status} ${response.statusText}`,
        url: this.url,
        requestBodyValues: prepared.body,
        statusCode: response.status,
        responseHeaders: headers,
        responseBody: rawText,
      });
    }

    const parsed = parseResponseJson(rawText);
    if (!parsed) {
      throw apiError({
        message: 'Invalid OpenAI Responses JSON response',
        url: this.url,
        requestBodyValues: prepared.body,
        statusCode: response.status,
        responseHeaders: headers,
        responseBody: rawText,
      });
    }
    if (parsed.error?.message) {
      throw apiError({
        message: parsed.error.message,
        url: this.url,
        requestBodyValues: prepared.body,
        statusCode: response.status,
        responseHeaders: headers,
        responseBody: rawText,
      });
    }

    const content = responseOutputToContent(parsed.output);
    return {
      content,
      finishReason: mapFinishReason(parsed.incomplete_details?.reason, content.some((part) => part.type === 'tool-call')),
      usage: mapUsage(parsed.usage),
      warnings: prepared.warnings,
      providerMetadata: finishProviderMetadata(parsed.id, parsed.service_tier ?? undefined),
      request: { body: prepared.body },
      response: {
        id: parsed.id,
        modelId: parsed.model,
        timestamp: new Date(parsed.created_at * 1000),
        headers,
        body: parsed,
      },
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const prepared = prepareRequestBody(
      this.modelId,
      options,
      true,
      this.supportsMaxOutputTokens,
      this.preserveItemIds,
    );
    const response = await this.fetchFn(this.url, {
      method: 'POST',
      headers: requestHeaders(options.headers),
      body: JSON.stringify(prepared.body),
      signal: options.abortSignal,
    });
    const headers = responseHeadersRecord(response);
    if (!response.ok) {
      const rawText = await response.text();
      throw apiError({
        message: extractResponseMessage(rawText) ?? `${response.status} ${response.statusText}`,
        url: this.url,
        requestBodyValues: prepared.body,
        statusCode: response.status,
        responseHeaders: headers,
        responseBody: rawText,
      });
    }
    if (!response.body) {
      throw apiError({
        message: 'OpenAI Responses stream body missing',
        url: this.url,
        requestBodyValues: prepared.body,
        statusCode: response.status,
        responseHeaders: headers,
      });
    }

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: prepared.warnings });
        const state = createStreamState(options.includeRawChunks === true);
        try {
          for await (const value of streamOpenAIResponsesEvents(response.body!)) {
            handleStreamEvent(value, controller, state);
          }
          flushStreamState(controller, state);
        } catch (error) {
          controller.error(error instanceof Error ? error : new Error(String(error)));
        } finally {
          state.textOpen.clear();
          state.reasoningOpen.clear();
        }
      },
    });

    return {
      stream,
      request: { body: prepared.body },
      response: { headers },
    };
  }
}

function prepareRequestBody(
  modelId: string,
  options: LanguageModelV3CallOptions,
  stream = false,
  supportsMaxOutputTokens = true,
  preserveItemIds = true,
): { body: OpenAIResponsesRequest; warnings: SharedV3Warning[] } {
  const warnings: SharedV3Warning[] = [];
  const providerOptions = getProviderOptions(options.providerOptions);
  const modelConfig = getModelConfig(modelId);

  if (options.topK != null) warnings.push({ type: 'unsupported', feature: 'topK' });
  if (options.seed != null) warnings.push({ type: 'unsupported', feature: 'seed' });
  if (options.presencePenalty != null) warnings.push({ type: 'unsupported', feature: 'presencePenalty' });
  if (options.frequencyPenalty != null) warnings.push({ type: 'unsupported', feature: 'frequencyPenalty' });
  if (options.stopSequences?.length) warnings.push({ type: 'unsupported', feature: 'stopSequences' });

  const input = promptToInput(options.prompt, modelConfig.systemMessageRole, preserveItemIds);
  const include = new Set(providerOptions.include ?? []);
  if (hasReasoningInput(input)) include.add('reasoning.encrypted_content');

  const body: OpenAIResponsesRequest = {
    model: modelId,
    input,
    ...(stream ? { stream: true } : {}),
    ...(supportsMaxOutputTokens && options.maxOutputTokens != null
      ? { max_output_tokens: options.maxOutputTokens }
      : {}),
    ...(providerOptions.maxToolCalls != null ? { max_tool_calls: providerOptions.maxToolCalls } : {}),
    ...(providerOptions.metadata ? { metadata: providerOptions.metadata } : {}),
    ...(providerOptions.parallelToolCalls != null ? { parallel_tool_calls: providerOptions.parallelToolCalls } : {}),
    ...(providerOptions.previousResponseId ? { previous_response_id: providerOptions.previousResponseId } : {}),
    store: providerOptions.store ?? false,
    ...(providerOptions.user ? { user: providerOptions.user } : {}),
    ...(providerOptions.instructions ? { instructions: providerOptions.instructions } : {}),
    ...(providerOptions.serviceTier ? { service_tier: providerOptions.serviceTier } : {}),
    ...(include.size > 0 ? { include: [...include] } : {}),
    ...(providerOptions.promptCacheKey ? { prompt_cache_key: providerOptions.promptCacheKey } : {}),
    ...(providerOptions.safetyIdentifier ? { safety_identifier: providerOptions.safetyIdentifier } : {}),
  };

  if (!modelConfig.isReasoningModel) {
    if (options.temperature != null) body.temperature = options.temperature;
    if (options.topP != null) body.top_p = options.topP;
    if (providerOptions.reasoningEffort != null) {
      warnings.push({ type: 'unsupported', feature: 'reasoningEffort', details: 'reasoningEffort is not supported for non-reasoning models' });
    }
  } else {
    if (options.temperature != null) {
      warnings.push({ type: 'unsupported', feature: 'temperature', details: 'temperature is not supported for reasoning models' });
    }
    if (options.topP != null) {
      warnings.push({ type: 'unsupported', feature: 'topP', details: 'topP is not supported for reasoning models' });
    }
    if (providerOptions.reasoningEffort != null || providerOptions.reasoningSummary != null) {
      body.reasoning = {
        ...(providerOptions.reasoningEffort ? { effort: providerOptions.reasoningEffort } : {}),
        ...(providerOptions.reasoningSummary ? { summary: providerOptions.reasoningSummary } : {}),
      };
    }
  }

  if (options.responseFormat?.type === 'json' || providerOptions.textVerbosity) {
    body.text = {
      ...(options.responseFormat?.type === 'json'
        ? {
            format: options.responseFormat.schema
              ? {
                  type: 'json_schema' as const,
                  name: options.responseFormat.name ?? 'response',
                  description: options.responseFormat.description,
                  schema: options.responseFormat.schema,
                  strict: providerOptions.strictJsonSchema ?? false,
                }
              : { type: 'json_object' as const },
          }
        : {}),
      ...(providerOptions.textVerbosity ? { verbosity: providerOptions.textVerbosity } : {}),
    };
  }

  const preparedTools = prepareTools(options.tools, options.toolChoice, providerOptions.strictJsonSchema ?? false);
  if (preparedTools.tools.length > 0) body.tools = preparedTools.tools;
  if (preparedTools.toolChoice) body.tool_choice = preparedTools.toolChoice;
  warnings.push(...preparedTools.warnings);

  return { body, warnings };
}

function getProviderOptions(providerOptions: LanguageModelV3CallOptions['providerOptions']): OpenAIResponsesProviderOptions {
  const options = providerOptions?.openai;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return {};
  return options as unknown as OpenAIResponsesProviderOptions;
}

function promptToInput(
  prompt: LanguageModelV3CallOptions['prompt'],
  systemRole: 'system' | 'developer',
  preserveItemIds: boolean,
): OpenAIResponsesInputItem[] {
  const input: OpenAIResponsesInputItem[] = [];
  for (const message of prompt) {
    if (message.role === 'system') {
      input.push({ role: systemRole, content: message.content });
      continue;
    }

    if (message.role === 'user') {
      const content = message.content.flatMap((part) => userPartToInput(part));
      if (content.length > 0) input.push({ role: 'user', content });
      continue;
    }

    if (message.role === 'assistant') {
      const reasoningParts = message.content.filter((part): part is LanguageModelV3ReasoningPart => part.type === 'reasoning');
      for (const part of reasoningParts) {
        if (!preserveItemIds) continue;
        const meta = providerMeta(part.providerOptions);
        if (meta.itemId || meta.reasoningEncryptedContent) {
          input.push({
            type: 'reasoning',
            id: meta.itemId ?? randomId('rs'),
            encrypted_content: meta.reasoningEncryptedContent ?? null,
            summary: [{ type: 'summary_text', text: part.text }],
          });
        }
      }

      const toolCalls = message.content.filter((part): part is LanguageModelV3ToolCallPart => part.type === 'tool-call');
      for (const part of toolCalls) {
        input.push({
          type: 'function_call',
          call_id: part.toolCallId,
          name: part.toolName,
          arguments: JSON.stringify(part.input ?? {}),
          ...withOptionalId(preserveItemIds ? providerMeta(part.providerOptions).itemId : undefined),
        });
      }

      const toolResults = message.content.filter((part): part is LanguageModelV3ToolResultPart => part.type === 'tool-result');
      for (const part of toolResults) {
        input.push({
          type: 'function_call_output',
          call_id: part.toolCallId,
          output: toolResultOutputToString(part.output),
        });
      }

      const textContent = message.content
        .filter((part): part is LanguageModelV3TextPart => part.type === 'text')
        .map((part) => ({ type: 'output_text' as const, text: part.text }));
      if (textContent.length > 0) {
        const first = message.content.find((part) => part.type === 'text' || part.type === 'reasoning' || part.type === 'tool-call');
        const meta = first ? providerMeta((first as { providerOptions?: unknown }).providerOptions) : {};
        input.push({
          role: 'assistant',
          content: textContent,
          ...withOptionalId(preserveItemIds ? meta.itemId : undefined),
        });
      }
      continue;
    }

    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type === 'tool-result') {
          input.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output: toolResultOutputToString(part.output),
          });
        }
        if (part.type === 'tool-approval-response') {
          input.push({
            type: 'mcp_approval_response',
            approval_request_id: part.approvalId,
            approve: part.approved,
          });
        }
      }
    }
  }
  return input;
}

function hasReasoningInput(input: OpenAIResponsesInputItem[]): boolean {
  return input.some((item) => 'type' in item && item.type === 'reasoning');
}

function userPartToInput(part: LanguageModelV3TextPart | LanguageModelV3FilePart): OpenAIResponsesUserContentPart[] {
  if (part.type === 'text') return [{ type: 'input_text' as const, text: part.text }];
  if (part.type !== 'file') return [];
  return filePartToInput(part);
}

function filePartToInput(part: LanguageModelV3FilePart): OpenAIResponsesUserContentPart[] {
  const data = part.data instanceof URL ? part.data.toString() : part.data;
  if (typeof data === 'string' && /^https?:\/\//.test(data)) {
    if (part.mediaType.startsWith('image/')) return [{ type: 'input_image' as const, image_url: data }];
    return [{ type: 'input_file' as const, file_url: data }];
  }

  if (part.mediaType.startsWith('image/')) {
    return [{ type: 'input_image' as const, image_url: toDataUrl(data, part.mediaType) }];
  }

  return [{
    type: 'input_file' as const,
    filename: part.filename,
    file_data: typeof data === 'string' ? data : Buffer.from(data).toString('base64'),
  }];
}

function prepareTools(
  tools: LanguageModelV3CallOptions['tools'],
  toolChoice: LanguageModelV3ToolChoice | undefined,
  strictJsonSchema: boolean,
): { tools: OpenAIResponsesTool[]; toolChoice?: OpenAIResponsesRequest['tool_choice']; warnings: SharedV3Warning[] } {
  const warnings: SharedV3Warning[] = [];
  const prepared: OpenAIResponsesTool[] = [];

  for (const tool of tools ?? []) {
    if (tool.type === 'function') {
      prepared.push({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as JSONSchema7,
        strict: strictJsonSchema,
      });
      continue;
    }

    const mapped = mapProviderTool(tool);
    if (mapped) prepared.push(mapped);
    else warnings.push({ type: 'unsupported', feature: `providerTool:${tool.id}` });
  }

  return {
    tools: prepared,
    toolChoice:
      toolChoice?.type === 'tool'
        ? { type: 'function', name: toolChoice.toolName }
        : toolChoice?.type,
    warnings,
  };
}

function mapProviderTool(tool: LanguageModelV3ProviderTool): OpenAIResponsesTool | null {
  if (!tool.id.startsWith('openai.')) return null;
  const suffix = tool.id.slice('openai.'.length);
  switch (suffix) {
    case 'web_search':
    case 'web_search_preview':
    case 'code_interpreter':
    case 'image_generation':
    case 'file_search':
    case 'local_shell':
      return { type: suffix, ...tool.args } as OpenAIResponsesTool;
    case 'computer_use':
    case 'computer_use_preview':
      return { type: 'computer_use_preview', ...tool.args } as OpenAIResponsesTool;
    default:
      return null;
  }
}

function responseOutputToContent(output: OpenAIResponsesOutputItem[]): LanguageModelV3Content[] {
  const content: LanguageModelV3Content[] = [];
  for (const item of output) {
    content.push(...responseItemToContent(item));
  }
  return content;
}

function responseItemToContent(item: OpenAIResponsesOutputItem): LanguageModelV3Content[] {
  switch (item.type) {
    case 'message':
      return item.content.flatMap((part) => {
        const meta = item.id ? openaiMeta({ itemId: item.id }) : undefined;
        return [
          { type: 'text' as const, text: part.text, ...(meta ? { providerMetadata: meta } : {}) },
          ...annotationsToSources(part.annotations),
        ];
      });
    case 'reasoning':
      return (item.summary.length > 0 ? item.summary : [{ type: 'summary_text', text: '' }]).map((part) => ({
        type: 'reasoning' as const,
        text: part.text,
        providerMetadata: openaiMeta({ itemId: item.id, reasoningEncryptedContent: item.encrypted_content ?? null }),
      }));
    case 'function_call':
      return [{
        type: 'tool-call',
        toolCallId: item.call_id,
        toolName: item.name,
        input: item.arguments,
        providerMetadata: openaiMeta({ itemId: item.id }),
      }];
    case 'web_search_call':
      return providerExecutedTool(item.id, 'web_search', item.action ?? { status: item.status }, { status: item.status });
    case 'file_search_call':
      return providerExecutedTool(item.id, 'file_search', { queries: item.queries ?? [] }, { results: item.results ?? [], status: item.status });
    case 'image_generation_call':
      return providerExecutedTool(item.id, 'image_generation', {}, { result: item.result ?? '', status: item.status });
    case 'code_interpreter_call':
      return providerExecutedTool(item.id, 'code_interpreter', { code: item.code, containerId: item.container_id }, { outputs: item.outputs ?? [], status: item.status });
    case 'local_shell_call':
      return [{
        type: 'tool-call',
        toolCallId: item.call_id,
        toolName: 'local_shell',
        input: JSON.stringify({ action: item.action }),
        providerExecuted: true,
        providerMetadata: openaiMeta({ itemId: item.id }),
      }];
    case 'computer_call':
      return providerExecutedTool(item.id, 'computer_use', {}, { status: item.status });
    default:
      return [];
  }
}

function providerExecutedTool(
  toolCallId: string,
  toolName: string,
  input: unknown,
  result: unknown,
): LanguageModelV3Content[] {
  return [
    { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(normalizeJsonValue(input)), providerExecuted: true },
    { type: 'tool-result', toolCallId, toolName, result: nonNullJsonValue(result) },
  ];
}

function mapUsage(usage: OpenAIResponsesUsage | undefined): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage?.input_tokens,
      noCache:
        usage?.input_tokens != null && usage.input_tokens_details?.cached_tokens != null
          ? usage.input_tokens - usage.input_tokens_details.cached_tokens
          : undefined,
      cacheRead: usage?.input_tokens_details?.cached_tokens ?? undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage?.output_tokens,
      text: undefined,
      reasoning: usage?.output_tokens_details?.reasoning_tokens ?? undefined,
    },
    raw: usage as unknown as Record<string, JSONValue> | undefined,
  };
}

function mapFinishReason(raw: string | undefined, hasToolCall: boolean) {
  if (hasToolCall) return { unified: 'tool-calls' as const, raw };
  if (!raw) return { unified: 'stop' as const, raw };
  if (raw.includes('max_output') || raw.includes('length')) return { unified: 'length' as const, raw };
  if (raw.includes('content_filter')) return { unified: 'content-filter' as const, raw };
  if (raw.includes('error') || raw.includes('failed')) return { unified: 'error' as const, raw };
  return { unified: 'other' as const, raw };
}

function createStreamState(includeRaw: boolean) {
  return {
    includeRaw,
    textOpen: new Set<string>(),
    reasoningOpen: new Set<string>(),
    functionCalls: new Map<string, { toolCallId: string; toolName: string; input: string }>(),
    usage: undefined as OpenAIResponsesUsage | undefined,
    finishRaw: undefined as string | undefined,
    responseId: undefined as string | undefined,
    responseModelId: undefined as string | undefined,
    responseTimestamp: undefined as Date | undefined,
    serviceTier: undefined as string | undefined,
    hasToolCall: false,
  };
}

function handleStreamEvent(
  event: OpenAIResponsesStreamEvent,
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  state: ReturnType<typeof createStreamState>,
) {
  const current = event as any;
  if (state.includeRaw) controller.enqueue({ type: 'raw', rawValue: event });

  switch (event.type) {
    case 'response.created':
      state.responseId = current.response.id;
      state.responseModelId = current.response.model;
      state.responseTimestamp = new Date(current.response.created_at * 1000);
      state.serviceTier = current.response.service_tier ?? undefined;
      controller.enqueue({
        type: 'response-metadata',
        id: state.responseId,
        modelId: state.responseModelId,
        timestamp: state.responseTimestamp,
      });
      return;
    case 'response.output_text.delta': {
      if (!state.textOpen.has(current.item_id)) {
        state.textOpen.add(current.item_id);
        controller.enqueue({
          type: 'text-start',
          id: current.item_id,
          providerMetadata: openaiMeta({ itemId: current.item_id }),
        });
      }
      controller.enqueue({
        type: 'text-delta',
        id: current.item_id,
        delta: current.delta,
        providerMetadata: openaiMeta({ itemId: current.item_id }),
      });
      return;
    }
    case 'response.reasoning_summary_part.added': {
      const id = `${current.item_id}:${current.summary_index}`;
      if (!state.reasoningOpen.has(id)) {
        state.reasoningOpen.add(id);
        controller.enqueue({
          type: 'reasoning-start',
          id,
          providerMetadata: openaiMeta({ itemId: current.item_id }),
        });
      }
      return;
    }
    case 'response.reasoning_summary_text.delta': {
      const id = `${current.item_id}:${current.summary_index}`;
      if (!state.reasoningOpen.has(id)) {
        state.reasoningOpen.add(id);
        controller.enqueue({
          type: 'reasoning-start',
          id,
          providerMetadata: openaiMeta({ itemId: current.item_id }),
        });
      }
      controller.enqueue({
        type: 'reasoning-delta',
        id,
        delta: current.delta,
        providerMetadata: openaiMeta({ itemId: current.item_id }),
      });
      return;
    }
    case 'response.output_item.added':
      if (current.item.type === 'function_call') {
        state.functionCalls.set(current.item.id, {
          toolCallId: current.item.call_id,
          toolName: current.item.name,
          input: '',
        });
        controller.enqueue({
          type: 'tool-input-start',
          id: current.item.call_id,
          toolName: current.item.name,
          providerMetadata: openaiMeta({ itemId: current.item.id }),
        });
      } else if (current.item.type === 'reasoning') {
        const id = `${current.item.id}:0`;
        if (!state.reasoningOpen.has(id)) {
          state.reasoningOpen.add(id);
          controller.enqueue({
            type: 'reasoning-start',
            id,
            providerMetadata: openaiMeta({ itemId: current.item.id, reasoningEncryptedContent: current.item.encrypted_content ?? null }),
          });
        }
      }
      return;
    case 'response.function_call_arguments.delta': {
      const call = state.functionCalls.get(current.item_id);
      if (!call) return;
      call.input += current.delta;
      controller.enqueue({
        type: 'tool-input-delta',
        id: call.toolCallId,
        delta: current.delta,
        providerMetadata: openaiMeta({ itemId: current.item_id }),
      });
      return;
    }
    case 'response.output_item.done':
      if (current.item.type === 'function_call') {
        const call = state.functionCalls.get(current.item.id) ?? {
          toolCallId: current.item.call_id,
          toolName: current.item.name,
          input: '',
        };
        const fullInput = current.item.arguments ?? call.input;
        if (fullInput.startsWith(call.input) && fullInput.length > call.input.length) {
          controller.enqueue({
            type: 'tool-input-delta',
            id: call.toolCallId,
            delta: fullInput.slice(call.input.length),
            providerMetadata: openaiMeta({ itemId: current.item.id }),
          });
        }
        controller.enqueue({
          type: 'tool-input-end',
          id: call.toolCallId,
          providerMetadata: openaiMeta({ itemId: current.item.id }),
        });
        controller.enqueue({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: fullInput,
          providerMetadata: openaiMeta({ itemId: current.item.id }),
        });
        state.functionCalls.delete(current.item.id);
        state.hasToolCall = true;
      } else if (current.item.type === 'message') {
        for (const part of current.item.content) {
          for (const source of annotationsToSources(part.annotations)) {
            controller.enqueue(source);
          }
        }
      } else if (current.item.type === 'reasoning') {
        const id = `${current.item.id}:0`;
        if (state.reasoningOpen.has(id)) {
          controller.enqueue({
            type: 'reasoning-end',
            id,
            providerMetadata: openaiMeta({ itemId: current.item.id, reasoningEncryptedContent: current.item.encrypted_content ?? null }),
          });
          state.reasoningOpen.delete(id);
        }
      } else {
        for (const part of responseItemToContent(current.item as OpenAIResponsesOutputItem)) {
          controller.enqueue(contentToStreamPart(part));
          if (part.type === 'tool-call') state.hasToolCall = true;
        }
      }
      return;
    case 'response.output_text.annotation.added':
      for (const source of annotationsToSources([current.annotation as OpenAIResponsesAnnotation])) controller.enqueue(source);
      return;
    case 'response.completed':
    case 'response.done':
    case 'response.incomplete':
      state.usage = current.response.usage;
      state.finishRaw = current.response.incomplete_details?.reason;
      state.serviceTier = current.response.service_tier ?? state.serviceTier;
      return;
    case 'response.failed':
    case 'error':
      throw apiError({
        message:
          current.error?.message ??
          current.response?.error?.message ??
          current.message ??
          current.error?.code ??
          'OpenAI Responses stream error',
        url: DEFAULT_URL,
        requestBodyValues: {},
      });
    default:
      return;
  }
}

function flushStreamState(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  state: ReturnType<typeof createStreamState>,
) {
  for (const id of state.textOpen) controller.enqueue({ type: 'text-end', id, providerMetadata: openaiMeta({ itemId: id }) });
  for (const id of state.reasoningOpen) controller.enqueue({ type: 'reasoning-end', id });
  controller.enqueue({
    type: 'finish',
    usage: mapUsage(state.usage),
    finishReason: mapFinishReason(state.finishRaw, state.hasToolCall),
    providerMetadata: finishProviderMetadata(state.responseId, state.serviceTier),
  });
  controller.close();
}

async function* streamOpenAIResponsesEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<OpenAIResponsesStreamEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseBlock(block);
        if (event && event !== '[DONE]') yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
    const trailing = parseSseBlock(buffer);
    if (trailing && trailing !== '[DONE]') yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): OpenAIResponsesStreamEvent | '[DONE]' | null {
  const lines = block.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!data) return null;
  if (data === '[DONE]') return '[DONE]';
  try {
    return JSON.parse(data) as OpenAIResponsesStreamEvent;
  } catch {
    return null;
  }
}

function contentToStreamPart(content: LanguageModelV3Content): LanguageModelV3StreamPart {
  return content as unknown as LanguageModelV3StreamPart;
}

function annotationsToSources(annotations: OpenAIResponsesAnnotation[] | null | undefined): Extract<LanguageModelV3Content, { type: 'source' }>[] {
  const sources: Extract<LanguageModelV3Content, { type: 'source' }>[] = [];
  for (const annotation of annotations ?? []) {
    if (annotation.type === 'url_citation') {
      sources.push({
        type: 'source',
        sourceType: 'url',
        id: randomId('src'),
        url: annotation.url,
        title: annotation.title,
      });
    } else if (annotation.type === 'file_citation') {
      sources.push({
        type: 'source',
        sourceType: 'document',
        id: randomId('doc'),
        mediaType: 'text/plain',
        title: annotation.quote ?? annotation.filename ?? 'Document',
        filename: annotation.filename ?? annotation.file_id,
      });
    }
  }
  return sources;
}

function withOptionalId(id: string | undefined) {
  return id ? { id } : {};
}

function providerMeta(providerOptions: unknown): { itemId?: string; reasoningEncryptedContent?: string | null } {
  if (!providerOptions || typeof providerOptions !== 'object' || Array.isArray(providerOptions)) return {};
  const openai = (providerOptions as { openai?: Record<string, unknown> }).openai;
  if (!openai || typeof openai !== 'object') return {};
  return {
    itemId: typeof openai.itemId === 'string' ? openai.itemId : undefined,
    reasoningEncryptedContent:
      typeof openai.reasoningEncryptedContent === 'string' ? openai.reasoningEncryptedContent : null,
  };
}

function openaiMeta(values: { itemId?: string; reasoningEncryptedContent?: string | null }): SharedV3ProviderMetadata {
  const openai: Record<string, JSONValue> = {};
  if (values.itemId) openai.itemId = values.itemId;
  if (values.reasoningEncryptedContent !== undefined) openai.reasoningEncryptedContent = values.reasoningEncryptedContent;
  return { openai };
}

function finishProviderMetadata(responseId: string | undefined, serviceTier: string | undefined): SharedV3ProviderMetadata | undefined {
  if (!responseId && !serviceTier) return undefined;
  const openai: Record<string, JSONValue> = {};
  if (responseId) openai.responseId = responseId;
  if (serviceTier) openai.serviceTier = serviceTier;
  return { openai };
}

function requestHeaders(headers: Record<string, string | undefined> | undefined) {
  return {
    'content-type': 'application/json',
    ...headers,
  };
}

function responseHeadersRecord(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  return headers;
}

function parseResponseJson(text: string): OpenAIResponsesResponse | null {
  try {
    return JSON.parse(text) as OpenAIResponsesResponse;
  } catch {
    return null;
  }
}

function extractResponseMessage(text: string): string | null {
  const parsed = parseResponseJson(text);
  return parsed?.error?.message ?? null;
}

function toolResultOutputToString(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    case 'execution-denied':
      return output.reason ?? 'execution denied';
    case 'content':
      return output.value
        .map((part) => {
          switch (part.type) {
            case 'text': return part.text;
            case 'file-data': return `[file:${part.filename ?? part.mediaType}]`;
            case 'file-url': return `[file-url:${part.url}]`;
            case 'file-id': return `[file-id:${typeof part.fileId === 'string' ? part.fileId : JSON.stringify(part.fileId)}]`;
            case 'image-data': return '[image-data]';
            case 'image-url': return `[image-url:${part.url}]`;
            case 'image-file-id': return '[image-file-id]';
            default: return '[custom]';
          }
        })
        .join('\n');
    default:
      return JSON.stringify(output);
  }
}

function toDataUrl(data: string | Uint8Array, mediaType: string): string {
  const base64 = typeof data === 'string' ? data : Buffer.from(data).toString('base64');
  return `data:${mediaType};base64,${base64}`;
}

function normalizeJsonValue(value: unknown): JSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === 'object') {
    const record: Record<string, JSONValue> = {};
    for (const [key, entry] of Object.entries(value)) record[key] = normalizeJsonValue(entry);
    return record;
  }
  return String(value);
}

function nonNullJsonValue(value: unknown): NonNullable<JSONValue> {
  const normalized = normalizeJsonValue(value);
  return normalized === null ? '' : normalized;
}

function apiError(input: ConstructorParameters<typeof APICallError>[0]) {
  return new APICallError({ isRetryable: input.statusCode != null ? input.statusCode >= 500 : false, ...input });
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function getModelConfig(modelId: string): { isReasoningModel: boolean; systemMessageRole: 'system' | 'developer' } {
  if (modelId.startsWith('gpt-5-chat')) return { isReasoningModel: false, systemMessageRole: 'system' };
  if (modelId.startsWith('o') || modelId.startsWith('gpt-5') || modelId.startsWith('codex-') || modelId.startsWith('computer-use')) {
    return { isReasoningModel: true, systemMessageRole: 'developer' };
  }
  return { isReasoningModel: false, systemMessageRole: 'system' };
}
