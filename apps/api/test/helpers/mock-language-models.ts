import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';

export function v3Usage(inputTotal: number, outputTotal: number) {
  return {
    inputTokens: { total: inputTotal, noCache: inputTotal, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
    totalTokens: inputTotal + outputTotal,
  };
}

export function extractModelToolNames(rawTools: unknown): string[] {
  if (Array.isArray(rawTools)) {
    return rawTools
      .map((entry) =>
        entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined,
      )
      .filter((name): name is string => typeof name === 'string')
      .sort();
  }
  if (rawTools && typeof rawTools === 'object') {
    return Object.keys(rawTools).sort();
  }
  return [];
}

function finishChunk(inputTotal: number, outputTotal: number, reason: 'stop' | 'tool-calls' = 'stop') {
  return {
    type: 'finish' as const,
    usage: v3Usage(inputTotal, outputTotal),
    finishReason: { unified: reason, raw: reason },
  };
}

export function makeStreamingModel(parts: LanguageModelV3StreamPart[]): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({ chunks: parts }),
    }),
  }) as unknown as LanguageModel;
}

export function makeTextModel(text: string, usage = v3Usage(11, 9)): LanguageModel {
  return makeStreamingModel([
    { type: 'text-start', id: '1' },
    { type: 'text-delta', id: '1', delta: text },
    { type: 'text-end', id: '1' },
    finishChunk(usage.inputTokens.total, usage.outputTokens.total),
  ]);
}

export function makeTextOnlyModel(text: string): LanguageModel {
  return makeTextModel(text, v3Usage(11, 7));
}

export function makeToolCaptureModel(capturedToolNames: string[][]): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      capturedToolNames.push(extractModelToolNames((options as { tools?: unknown }).tools));
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'done' },
            { type: 'text-end', id: '1' },
            finishChunk(9, 4),
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

export function makeMcpToolCallModel(matchToolName: (name: string) => boolean): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      const hasToolResults = options.prompt.some((m) =>
        Array.isArray(m.content)
          ? m.content.some((c: { type?: string }) => c.type === 'tool-result')
          : false,
      );
      if (hasToolResults) {
        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: [
              { type: 'text-start', id: '2' },
              { type: 'text-delta', id: '2', delta: 'done' },
              { type: 'text-end', id: '2' },
              finishChunk(12, 4),
            ],
          }),
        };
      }

      const toolNames = extractModelToolNames((options as { tools?: unknown }).tools);
      const toolName = toolNames.find(matchToolName);
      if (!toolName) {
        throw new Error(
          `expected MCP tool not found in model palette; saw ${toolNames.join(', ')}`,
        );
      }
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            {
              type: 'tool-call',
              toolCallId: 'call-mcp-1',
              toolName,
              input: JSON.stringify({}),
            },
            finishChunk(10, 3, 'tool-calls'),
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

export function makeFilesystemToolCallModel(): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      const hasToolResults = options.prompt.some((message) =>
        Array.isArray(message.content)
          ? message.content.some((chunk: { type?: string }) => chunk.type === 'tool-result')
          : false,
      );
      if (!hasToolResults) {
        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: [
              { type: 'text-start', id: '1' },
              { type: 'text-delta', id: '1', delta: 'Checking the file.' },
              { type: 'text-end', id: '1' },
              {
                type: 'tool-call',
                toolCallId: 'call-fs-1',
                toolName: 'filesystem',
                input: JSON.stringify({
                  action: 'read',
                  resourceType: 'file',
                  resourcePath: 'README.md',
                }),
              },
              finishChunk(10, 5, 'tool-calls'),
            ],
          }),
        };
      }
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: 'text-start', id: '2' },
            { type: 'text-delta', id: '2', delta: 'Done — README looks good.' },
            { type: 'text-end', id: '2' },
            finishChunk(14, 8),
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
}
