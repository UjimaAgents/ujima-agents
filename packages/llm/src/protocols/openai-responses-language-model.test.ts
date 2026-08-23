import { describe, expect, it } from 'vitest';
import { OpenAIResponsesLanguageModel } from './openai-responses-language-model.js';

describe('OpenAIResponsesLanguageModel', () => {
  it('scopes Codex turn state by conversation and clears it after a terminal response', async () => {
    const requestHeaders: Headers[] = [];
    let requestNumber = 0;
    const model = new OpenAIResponsesLanguageModel('gpt-5.4-mini', {
      url: 'https://codex.test/backend-api/codex/responses',
      preserveItemIds: false,
      fetch: async (_request, init) => {
        requestHeaders.push(new Headers(init?.headers));
        requestNumber += 1;
        const hasToolCall = requestNumber === 1;
        return new Response([
          'data: {"type":"response.created","response":{"id":"resp_1","created_at":1,"model":"gpt-5.4-mini"}}\n\n',
          ...(requestNumber === 1
            ? ['data: {"type":"codex.response.metadata","headers":{"x-codex-turn-state":"turn-a"}}\n\n']
            : []),
          ...(hasToolCall
            ? [
                'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":""}}\n\n',
                'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":"{}"}}\n\n',
              ]
            : ['data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"done"}\n\n']),
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
          'data: [DONE]\n\n',
        ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
    });

    const run = async (conversationKey: string) => {
      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        providerOptions: { openai: { conversationKey } },
      });
      const reader = result.stream.getReader();
      while (!(await reader.read()).done) {
        // Drain the stream to exercise the request lifecycle.
      }
    };

    await run('org:thread-a:run-a');
    await run('org:thread-b:run-b');
    await run('org:thread-a:run-a');
    await run('org:thread-a:run-a');

    expect(requestHeaders[0]?.get('x-codex-turn-state')).toBeNull();
    expect(requestHeaders[1]?.get('x-codex-turn-state')).toBeNull();
    expect(requestHeaders[2]?.get('x-codex-turn-state')).toBe('turn-a');
    expect(requestHeaders[3]?.get('x-codex-turn-state')).toBeNull();
  });

  it('preserves assistant text and tool-call item order across tool continuations', async () => {
    let requestBody: any;
    const model = new OpenAIResponsesLanguageModel('gpt-5.4-mini', {
      url: 'https://codex.test/backend-api/codex/responses',
      fetch: async (_request, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          id: 'resp_order',
          created_at: 1,
          model: 'gpt-5.4-mini',
          output: [{ type: 'message', role: 'assistant', id: 'msg_final', content: [{ type: 'output_text', text: 'done', annotations: [] }] }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'inspect' }] },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'plan', providerOptions: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc' } } },
            { type: 'text', text: 'I will inspect first.', providerOptions: { openai: { itemId: 'msg_1' } } },
            { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'a.txt' }, providerOptions: { openai: { itemId: 'fc_1' } } },
          ],
        },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'read_file', output: { type: 'text', value: 'contents' } }] },
      ],
    });

    expect(requestBody.input.slice(1)).toEqual([
      { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc', summary: [{ type: 'summary_text', text: 'plan' }] },
      { role: 'assistant', id: 'msg_1', content: [{ type: 'output_text', text: 'I will inspect first.' }] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'contents' },
    ]);
  });

  it('forwards explicit Responses options in the request body', async () => {
    let requestBody: any;
    const model = new OpenAIResponsesLanguageModel('gpt-5.4-mini', {
      url: 'https://codex.test/backend-api/codex/responses',
      fetch: async (_request, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          id: 'resp_1',
          created_at: 1,
          model: 'gpt-5.4-mini',
          output: [{ type: 'message', role: 'assistant', id: 'msg_1', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
          usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 } },
          service_tier: 'priority',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await model.doGenerate({
      prompt: [{ role: 'system', content: 'sys' }, { role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 321,
      providerOptions: {
        openai: {
          include: ['reasoning.encrypted_content'],
          previousResponseId: 'resp_prev',
          promptCacheKey: 'cache-key',
          serviceTier: 'priority',
          store: false,
          textVerbosity: 'high',
          reasoningEffort: 'high',
        },
      },
      responseFormat: {
        type: 'json',
        name: 'reply',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: false },
      },
    });

    expect(requestBody).toMatchObject({
      model: 'gpt-5.4-mini',
      max_output_tokens: 321,
      previous_response_id: 'resp_prev',
      prompt_cache_key: 'cache-key',
      service_tier: 'priority',
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning: { effort: 'high' },
      text: {
        verbosity: 'high',
        format: {
          type: 'json_schema',
          name: 'reply',
        },
      },
    });
  });

  it('can omit max_output_tokens when transport does not support it', async () => {
    let requestBody: any;
    const model = new OpenAIResponsesLanguageModel('gpt-5.4-mini', {
      url: 'https://codex.test/backend-api/codex/responses',
      supportsMaxOutputTokens: false,
      fetch: async (_request, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          id: 'resp_1',
          created_at: 1,
          model: 'gpt-5.4-mini',
          output: [{ type: 'message', role: 'assistant', id: 'msg_1', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
          usage: { input_tokens: 10, output_tokens: 3 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 321,
    });

    expect(requestBody.max_output_tokens).toBeUndefined();
  });

  it('parses stream lifecycle events into normalized AI SDK chunks', async () => {
    const model = new OpenAIResponsesLanguageModel('gpt-5.4-mini', {
      url: 'https://codex.test/backend-api/codex/responses',
      fetch: async () => new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_1","created_at":1,"model":"gpt-5.4-mini","service_tier":"priority"}}\n\n',
          'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rs_1","encrypted_content":"enc"}}\n\n',
          'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","summary_index":0,"delta":"think"}\n\n',
          'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":""}}\n\n',
          'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":1,"delta":"{\\"path\\":\\"a.txt\\"}"}\n\n',
          'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}","status":"completed"}}\n\n',
          'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"ok"}\n\n',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":5,"input_tokens_details":{"cached_tokens":2},"output_tokens_details":{"reasoning_tokens":3}},"service_tier":"priority"}}\n\n',
          'data: [DONE]\n\n',
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    });

    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      providerOptions: { openai: { reasoningEffort: 'high' } },
      includeRawChunks: true,
    });

    const reader = result.stream.getReader();
    const parts: any[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    expect(parts.some((part) => part.type === 'response-metadata' && part.id === 'resp_1')).toBe(true);
    expect(parts.some((part) => part.type === 'reasoning-start' && part.id === 'rs_1:0')).toBe(true);
    expect(parts.some((part) => part.type === 'reasoning-delta' && part.delta === 'think')).toBe(true);
    expect(parts.some((part) => part.type === 'tool-input-start' && part.id === 'call_1')).toBe(true);
    expect(parts.some((part) => part.type === 'tool-input-delta' && part.delta.includes('a.txt'))).toBe(true);
    expect(parts.some((part) => part.type === 'tool-call' && part.toolName === 'read_file')).toBe(true);
    expect(parts.some((part) => part.type === 'text-delta' && part.delta === 'ok')).toBe(true);
    expect(parts.some((part) => part.type === 'raw')).toBe(true);
    expect(parts.some((part) => part.type === 'finish' && part.usage.outputTokens.reasoning === 3)).toBe(true);
    expect(parts.some((part) => part.type === 'finish' && part.providerMetadata?.openai?.serviceTier === 'priority')).toBe(true);
  });

  it('emits text when Codex sends it only on output_item.done', async () => {
    const model = new OpenAIResponsesLanguageModel('gpt-5.4-mini', {
      url: 'https://codex.test/backend-api/codex/responses',
      fetch: async () => new Response(
        [
          'data: {"type":"response.created","response":{"id":"resp_2","created_at":1,"model":"gpt-5.4-mini"}}\n\n',
          'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","role":"assistant","id":"msg_2","content":[{"type":"output_text","text":"I will inspect the files first.","annotations":[]}]}}\n\n',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":5}}}\n\n',
          'data: [DONE]\n\n',
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    });

    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'inspect' }] }],
    });
    const reader = result.stream.getReader();
    const parts: any[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    expect(parts.some((part) => part.type === 'text-delta' && part.delta === 'I will inspect the files first.')).toBe(true);
  });
});
