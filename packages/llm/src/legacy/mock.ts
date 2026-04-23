import type { LLMProvider, LLMStreamDelta, LLMStreamInput } from './types';

export type MockTurn = LLMStreamDelta[];

export interface MockProviderOptions {
  script: MockTurn[];
  onCall?: (input: LLMStreamInput, turnIndex: number) => void;
}

export function createMockProvider(options: MockProviderOptions): LLMProvider {
  let turn = 0;
  const { script, onCall } = options;

  return {
    id: 'mock',
    async *stream(input) {
      const current = turn;
      const deltas = script[turn] ?? [{ type: 'finish', reason: 'end_turn' }];
      turn++;
      onCall?.(input, current);
      for (const d of deltas) {
        yield d;
      }
    },
  };
}

export function textTurn(text: string): MockTurn {
  return [
    { type: 'text', text },
    { type: 'finish', reason: 'end_turn' },
  ];
}

export function toolTurn(
  id: string,
  name: string,
  args: Record<string, unknown>,
  preamble?: string,
): MockTurn {
  const deltas: LLMStreamDelta[] = [];
  if (preamble) deltas.push({ type: 'text', text: preamble });
  deltas.push({ type: 'tool_call', id, name, arguments: args });
  deltas.push({ type: 'finish', reason: 'tool_use' });
  return deltas;
}
