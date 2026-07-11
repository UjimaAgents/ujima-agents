/**
 * Claude Code SDK wrapper — bridges the @anthropic-ai/claude-agent-sdk
 * into an ai-sdk compatible LanguageModel for the anthropic-claude-code provider.
 *
 * The SDK launches the Claude Code CLI as a subprocess and communicates via
 * JSON messages. We collect the assistant text response and map it to the
 * ai-sdk stream format.
 */
import type { LanguageModel } from 'ai';
import { query } from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeCodeModelOptions {
  modelId: string;
  cwd?: string;
}

interface TextBlock { type: string; text?: string }
interface SdkMessage {
  type?: string;
  message?: { content?: TextBlock[] };
  delta?: { type: string; text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

function extractPrompt(prompt: string | { type: string; text?: string }[]): string {
  if (typeof prompt === 'string') return prompt;
  return prompt
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');
}

export function createClaudeCodeModel(options: ClaudeCodeModelOptions): LanguageModel {
  const modelId = options.modelId;

  return {
    specificationVersion: 'v2',
    provider: 'anthropic.claude-code',
    modelId,

    async doGenerate(params: {
      prompt: string | { type: string; text?: string }[];
      maxTokens?: number;
      temperature?: number;
      [key: string]: unknown;
    }) {
      const prompt = extractPrompt(params.prompt);

      try {
        const result = query({
          prompt,
          options: {
            model: modelId,
            ...(options.cwd ? { cwd: options.cwd } : {}),
            includePartialMessages: false,
          },
        });

        let text = '';
        let usage = { promptTokens: 0, completionTokens: 0 };

        for await (const message of result as AsyncIterable<SdkMessage>) {
          if (message.type === 'assistant' && message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'text' && block.text) {
                text += block.text;
              }
            }
          }
          if (message.type === 'result' && message.usage) {
            usage = {
              promptTokens: message.usage.input_tokens ?? 0,
              completionTokens: message.usage.output_tokens ?? 0,
            };
          }
        }

        return {
          text,
          finishReason: 'stop' as const,
          usage,
          rawCall: { rawPrompt: prompt, rawSettings: {} },
          warnings: [],
          request: { body: JSON.stringify({ prompt, model: modelId }) },
          response: {
            id: 'claude-code',
            timestamp: new Date(),
            modelId,
            headers: {},
            body: JSON.stringify({ text }),
          },
        };
      } catch (error) {
        throw new Error(
          `Claude Code SDK error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },

    async doStream(params: {
      prompt: string | { type: string; text?: string }[];
      maxTokens?: number;
      temperature?: number;
      [key: string]: unknown;
    }) {
      const prompt = extractPrompt(params.prompt);

      async function* streamText() {
        try {
          const result = query({
            prompt,
            options: {
              model: modelId,
              ...(options.cwd ? { cwd: options.cwd } : {}),
              includePartialMessages: true,
            },
          });

          for await (const message of result as AsyncIterable<SdkMessage>) {
            if (message.type === 'stream_event' && message.delta?.type === 'text_delta' && message.delta.text) {
              yield {
                type: 'text-delta' as const,
                textDelta: message.delta.text,
              };
            }
            if (message.type === 'assistant' && message.message?.content) {
              for (const block of message.message.content) {
                if (block.type === 'text' && block.text) {
                  yield {
                    type: 'text-delta' as const,
                    textDelta: block.text,
                  };
                }
              }
            }
          }

          yield {
            type: 'finish' as const,
            finishReason: 'stop' as const,
            usage: { promptTokens: 0, completionTokens: 0 },
          };
        } catch (error) {
          throw new Error(
            `Claude Code SDK stream error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return {
        stream: streamText(),
        rawCall: { rawPrompt: prompt, rawSettings: {} },
        warnings: [],
        request: { body: JSON.stringify({ prompt, model: modelId }) },
      };
    },
  } as unknown as LanguageModel;
}
