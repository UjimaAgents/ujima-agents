import type { Spirit } from '@ujima/shared';

export type SpiritRunPhase =
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

export class SpiritRunState {
  phase: SpiritRunPhase = 'running';
  iteration = 0;
  toolCallCount = 0;
  inputTokens = 0;
  outputTokens = 0;
  lastText = '';
  lastMessageId: string | undefined = undefined;
  error: string | undefined = undefined;

  get totalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  trackStep(toolCalls: number, tokens?: { input?: number; output?: number }): void {
    this.iteration++;
    this.toolCallCount += toolCalls;
    if (tokens) {
      this.inputTokens += tokens.input ?? 0;
      this.outputTokens += tokens.output ?? 0;
    }
  }

  complete(text: string, messageId?: string): void {
    this.phase = 'completed';
    this.lastText = text;
    if (messageId !== undefined) this.lastMessageId = messageId;
  }

  fail(err: string): void {
    this.phase = 'failed';
    this.error = err;
  }

  cancel(text?: string): void {
    this.phase = 'cancelled';
    if (text !== undefined) this.lastText = text;
  }

  waitForApproval(): void {
    this.phase = 'waiting_for_approval';
  }

  waitForInput(): void {
    this.phase = 'waiting_for_input';
  }

  applyToSpirit(spirit: Spirit): Spirit {
    return {
      ...spirit,
      status: this.phase,
      iteration: spirit.iteration + this.iteration,
      tokensUsed: spirit.tokensUsed + this.totalTokens,
      lastMessageId: this.lastMessageId ?? spirit.lastMessageId,
      lastError: this.error ?? spirit.lastError,
    };
  }
}
