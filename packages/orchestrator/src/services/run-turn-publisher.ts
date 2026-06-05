import type { Message } from '@ujima/shared';
import { hasTokenUsage, type NormalizedTokenUsage } from './token-usage.js';

export interface RunTurnPublishSnapshot {
  publishedAnyText: boolean;
  publishedArtifactFile: boolean;
  publishedContent: Set<string>;
  lastMessageId?: string;
}

export class RunTurnPublisher {
  private lastMessage: Message | undefined;
  private lastContent = '';
  private publishedAnyText = false;
  private publishedArtifactFile = false;
  private publishedContent = new Set<string>();

  constructor(
    private publish: (message: Message) => Message,
    private persist?: (message: Message) => void,
  ) {}

  publishMessage(message: Message): Message {
    const saved = this.publish(message);
    this.lastMessage = saved;
    this.lastContent = saved.content;
    if (saved.content.trim().length > 0) {
      this.publishedAnyText = true;
    }
    this.publishedContent.add(saved.content);
    return saved;
  }

  markArtifactFilePublished(): void {
    this.publishedArtifactFile = true;
  }

  /**
   * Silently stamp final token usage onto the last published
   * message. Persists via the optional repo callback; the live
   * counter rides on `run:tokens`, so we never re-broadcast.
   */
  backfillTokens(input: {
    finalText: string;
    lastText: string;
    terminatingTool: string | null;
    usage: NormalizedTokenUsage;
  }): void {
    if (!this.lastMessage || !hasTokenUsage(input.usage)) return;
    if (input.finalText && input.finalText !== input.lastText && !input.terminatingTool) return;
    if ((this.lastMessage.inputTokens ?? 0) > 0 || (this.lastMessage.outputTokens ?? 0) > 0) return;
    const updated: Message = {
      ...this.lastMessage,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      editedAt: new Date().toISOString(),
    };
    this.lastMessage = updated;
    this.persist?.(updated);
  }

  snapshot(): RunTurnPublishSnapshot {
    return {
      publishedAnyText: this.publishedAnyText,
      publishedArtifactFile: this.publishedArtifactFile,
      publishedContent: this.publishedContent,
      lastMessageId: this.lastMessage?.id,
    };
  }

  get lastContentValue(): string {
    return this.lastContent;
  }
}
