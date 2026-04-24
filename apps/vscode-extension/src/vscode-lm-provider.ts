import * as vscode from 'vscode';
import type {
  LLMContentPart,
  LLMMessage,
  LLMProvider,
  LLMStreamDelta,
  LLMStreamInput,
  LLMToolSpec,
} from '@ujima/llm/legacy';

export interface VscodeLmProviderOptions {
  vendor?: string;
  family?: string;
  channel?: vscode.OutputChannel;
}

export function createVscodeLmProvider(options: VscodeLmProviderOptions = {}): LLMProvider | undefined {
  if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') return undefined;

  return {
    id: 'vscode-lm',
    async *stream(input: LLMStreamInput): AsyncIterable<LLMStreamDelta> {
      const cfg = vscode.workspace.getConfiguration('ujima.llm.vscodeLm');
      const cfgVendor = cfg.get<string>('vendor');
      const cfgFamily = cfg.get<string>('family');
      const selector: vscode.LanguageModelChatSelector = {};
      const vendor = options.vendor ?? (cfgVendor && cfgVendor.trim() ? cfgVendor.trim() : undefined);
      const family = options.family ?? (cfgFamily && cfgFamily.trim() ? cfgFamily.trim() : undefined);
      if (vendor) selector.vendor = vendor;
      if (family) selector.family = family;

      let models: readonly vscode.LanguageModelChat[];
      try {
        models = await vscode.lm.selectChatModels(selector);
      } catch (err) {
        throw wrapLmError(err, 'selectChatModels failed');
      }
      if (models.length === 0) {
        throw new Error(
          'vscode.lm: no chat models available. Install GitHub Copilot (or another Language Model extension) and sign in, then retry.',
        );
      }

      const ordered = orderCandidates(models);
      const messages = toLmMessages(input.messages);
      const requestOptions: vscode.LanguageModelChatRequestOptions = {};
      if (input.tools && input.tools.length > 0) {
        requestOptions.tools = input.tools.map(toLmTool);
      }

      const cts = new vscode.CancellationTokenSource();
      const onAbort = (): void => cts.cancel();
      if (input.abortSignal) {
        if (input.abortSignal.aborted) cts.cancel();
        else input.abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      let stopReason: LLMStreamDelta & { type: 'finish' } = { type: 'finish', reason: 'end_turn' };
      let lastErr: unknown;
      try {
        for (let i = 0; i < ordered.length; i++) {
          const model = ordered[i];
          if (!model) continue;
          options.channel?.appendLine(
            `[vscode-lm] trying ${model.vendor}/${model.family} (id=${model.id})`,
          );
          try {
            const response = await model.sendRequest(messages, requestOptions, cts.token);
            let sawToolCall = false;
            let yielded = false;
            for await (const part of response.stream) {
              if (part instanceof vscode.LanguageModelTextPart) {
                if (part.value) {
                  yielded = true;
                  yield { type: 'text', text: part.value };
                }
              } else if (part instanceof vscode.LanguageModelToolCallPart) {
                sawToolCall = true;
                yielded = true;
                yield {
                  type: 'tool_call',
                  id: part.callId,
                  name: part.name,
                  arguments: (part.input ?? {}) as Record<string, unknown>,
                };
              }
            }
            stopReason = { type: 'finish', reason: sawToolCall ? 'tool_use' : 'end_turn' };
            options.channel?.appendLine(
              `[vscode-lm] ok via ${model.vendor}/${model.family}${yielded ? '' : ' (no content)'}`,
            );
            lastErr = undefined;
            break;
          } catch (err) {
            lastErr = err;
            if (cts.token.isCancellationRequested) throw err;
            if (!isModelUnsupported(err) || i === ordered.length - 1) throw err;
            options.channel?.appendLine(
              `[vscode-lm] ${model.id} rejected (${summarize(err)}) — trying next candidate`,
            );
          }
        }
      } catch (err) {
        if (cts.token.isCancellationRequested) {
          stopReason = { type: 'finish', reason: 'error' };
          throw wrapLmError(err, 'request aborted');
        }
        throw wrapLmError(err, 'sendRequest failed');
      } finally {
        if (input.abortSignal) input.abortSignal.removeEventListener('abort', onAbort);
        cts.dispose();
      }

      if (lastErr) throw wrapLmError(lastErr, 'sendRequest failed');
      yield stopReason;
    },
  };
}

function toLmMessages(msgs: LLMMessage[]): vscode.LanguageModelChatMessage[] {
  const out: vscode.LanguageModelChatMessage[] = [];
  for (const m of msgs) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : flattenText(m.content);
      if (text) out.push(vscode.LanguageModelChatMessage.User(text));
      continue;
    }
    if (m.role === 'tool') {
      const parts = normalizeParts(m.content);
      const toolResults: vscode.LanguageModelToolResultPart[] = [];
      for (const p of parts) {
        if (p.type === 'tool_result') {
          const content = typeof p.content === 'string' ? p.content : JSON.stringify(p.content);
          toolResults.push(new vscode.LanguageModelToolResultPart(p.toolCallId, [new vscode.LanguageModelTextPart(content)]));
        }
      }
      if (toolResults.length > 0) out.push(vscode.LanguageModelChatMessage.User(toolResults));
      continue;
    }
    const parts = normalizeParts(m.content);
    if (m.role === 'assistant') {
      const mapped: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
      for (const p of parts) {
        if (p.type === 'text' && p.text) mapped.push(new vscode.LanguageModelTextPart(p.text));
        else if (p.type === 'tool_call') {
          mapped.push(new vscode.LanguageModelToolCallPart(p.id, p.name, p.arguments));
        }
      }
      if (mapped.length > 0) out.push(vscode.LanguageModelChatMessage.Assistant(mapped));
    } else {
      const mapped: (vscode.LanguageModelTextPart | vscode.LanguageModelToolResultPart)[] = [];
      for (const p of parts) {
        if (p.type === 'text' && p.text) mapped.push(new vscode.LanguageModelTextPart(p.text));
        else if (p.type === 'tool_result') {
          const content = typeof p.content === 'string' ? p.content : JSON.stringify(p.content);
          mapped.push(new vscode.LanguageModelToolResultPart(p.toolCallId, [new vscode.LanguageModelTextPart(content)]));
        }
      }
      if (mapped.length > 0) out.push(vscode.LanguageModelChatMessage.User(mapped));
    }
  }
  return out;
}

function normalizeParts(content: string | LLMContentPart[]): LLMContentPart[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  return content;
}

function flattenText(parts: LLMContentPart[]): string {
  return parts
    .filter((p): p is Extract<LLMContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function toLmTool(t: LLMToolSpec): vscode.LanguageModelChatTool {
  return {
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.parameters,
  };
}

// Copilot publishes some families via selectChatModels that aren't callable through
// the LM API (they reject sendRequest with "model not supported"). Prefer known-good
// families first so the user doesn't see spurious failures.
const PREFERRED_FAMILIES = [
  'gpt-4o',
  'gpt-4o-mini',
  'claude-3.5-sonnet',
  'claude-3-5-sonnet',
  'claude-3.7-sonnet',
  'claude-sonnet-4',
];

function orderCandidates(
  models: readonly vscode.LanguageModelChat[],
): vscode.LanguageModelChat[] {
  const score = (m: vscode.LanguageModelChat): number => {
    const fam = (m.family ?? '').toLowerCase();
    const idx = PREFERRED_FAMILIES.findIndex((p) => fam.includes(p));
    return idx === -1 ? PREFERRED_FAMILIES.length : idx;
  };
  return [...models].sort((a, b) => score(a) - score(b));
}

function isModelUnsupported(err: unknown): boolean {
  if (err instanceof vscode.LanguageModelError) {
    if (err.code === 'NotFound' || err.code === 'Blocked') return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /model (is )?not supported|unknown_model|model_not_found|does not support/i.test(msg);
}

function summarize(err: unknown): string {
  if (err instanceof vscode.LanguageModelError) return `${err.code}: ${err.message}`;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}

function wrapLmError(err: unknown, prefix: string): Error {
  if (err instanceof vscode.LanguageModelError) {
    return new Error(`vscode.lm ${prefix}: [${err.code}] ${err.message}`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`vscode.lm ${prefix}: ${msg}`);
}
