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

  constructor(private publish: (message: Message) => Message) {}

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
   * Return the last published message stamped with final token
   * usage so the caller can persist it to the DB without a realtime
   * re-broadcast. The live counter rides on `run:tokens`; this
   * footer only matters after reload.
   */
  backfillTokens(input: {
    finalText: string;
    lastText: string;
    terminatingTool: string | null;
    usage: NormalizedTokenUsage;
  }): Message | undefined {
    if (!this.lastMessage || !hasTokenUsage(input.usage)) return undefined;
    if (input.finalText && input.finalText !== input.lastText && !input.terminatingTool) return undefined;
    if ((this.lastMessage.inputTokens ?? 0) > 0 || (this.lastMessage.outputTokens ?? 0) > 0) return undefined;
    const updated: Message = {
      ...this.lastMessage,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      editedAt: new Date().toISOString(),
    };
    this.lastMessage = updated;
    return updated;
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
