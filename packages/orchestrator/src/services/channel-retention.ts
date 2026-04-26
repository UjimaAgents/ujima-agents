import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message, MessageMention } from '@ujima/shared';
import type { ArchivedChannelMessageStore } from './conversation.js';
import type { ApiRepository, PaginatedMessages } from './repository-reader.js';

interface ArchivedMessageRecord {
  message: Message;
  mentions: MessageMention[];
}

export class ChannelRetentionService implements ArchivedChannelMessageStore {
  constructor(
    private readonly repo: ApiRepository,
    private readonly archiveRoot: string,
  ) {}

  async archiveExpiredMessages(
    organizationId: string,
    now = new Date(),
  ): Promise<{ archivedMessages: number }> {
    let archivedMessages = 0;
    for (const channel of this.repo.listAllChannels(organizationId)) {
      const retentionMs = retentionForChannelKind(channel.kind);
      if (retentionMs === null) continue;

      const cutoffIso = new Date(now.getTime() - retentionMs).toISOString();
      const messages = await this.collectChannelMessages(organizationId, channel.id);
      const expired = messages.filter((message) => message.createdAt < cutoffIso);
      if (expired.length === 0) continue;

      for (const message of expired) {
        const mentions = this.repo.listMessageMentions(message.id);
        await this.appendArchivedRecord(channel.id, {
          message,
          mentions,
        });
        this.repo.deleteMessageMentions(message.id);
      }
      this.repo.deleteMessages(organizationId, expired.map((message) => message.id));
      archivedMessages += expired.length;
    }

    return { archivedMessages };
  }

  async listChannelMessages(input: {
    organizationId: string;
    channelId: string;
    cursor?: string;
    since?: string;
    limit?: number;
  }): Promise<PaginatedMessages> {
    const records = await this.loadArchivedRecords(input.channelId);
    const data = paginateArchivedMessages(records, input);
    return data;
  }

  async searchChannelMessages(input: {
    organizationId: string;
    channelId: string;
    query: string;
    cursor?: string;
    since?: string;
    limit?: number;
  }): Promise<PaginatedMessages> {
    const records = await this.loadArchivedRecords(input.channelId);
    const filtered = records.filter((record) => matchesQuery(record.message.content, input.query));
    return paginateArchivedMessages(filtered, input);
  }

  private async collectChannelMessages(
    organizationId: string,
    channelId: string,
  ): Promise<Message[]> {
    const messages: Message[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = this.repo.listChannelMessages(organizationId, channelId, {
        cursor,
        limit: 100,
      });
      messages.push(...page.data);
      if (!page.hasMore || !page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }
    return messages;
  }

  private async appendArchivedRecord(
    channelId: string,
    record: ArchivedMessageRecord,
  ): Promise<void> {
    const month = record.message.createdAt.slice(0, 7);
    const channelDir = join(this.archiveRoot, 'archives', 'channels', channelId);
    await mkdir(channelDir, { recursive: true });
    const jsonlPath = join(channelDir, `${month}.jsonl`);
    const indexPath = join(channelDir, `${month}.index.json`);

    await appendFile(jsonlPath, `${JSON.stringify(record)}\n`, 'utf8');

    const existing = await readJsonArray<ArchivedMessageRecord>(indexPath);
    existing.push(record);
    await writeFile(indexPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  }

  private async loadArchivedRecords(channelId: string): Promise<ArchivedMessageRecord[]> {
    const channelDir = join(this.archiveRoot, 'archives', 'channels', channelId);
    try {
      const entries = (await readdir(channelDir))
        .filter((entry) => entry.endsWith('.index.json'))
        .sort();
      const batches = await Promise.all(
        entries.map((entry) => readJsonArray<ArchivedMessageRecord>(join(channelDir, entry))),
      );
      return batches.flat().sort((left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt),
      );
    } catch {
      return [];
    }
  }
}

function retentionForChannelKind(kind: string): number | null {
  if (kind === 'general' || kind === 'group' || kind === 'task-run') {
    return 90 * 24 * 60 * 60 * 1000;
  }
  return null;
}

function paginateArchivedMessages(
  records: ArchivedMessageRecord[],
  input: {
    cursor?: string;
    since?: string;
    limit?: number;
  },
): PaginatedMessages {
  const limit = input.limit ?? 50;
  let messages = records.map((record) => record.message);
  if (input.since) {
    messages = messages.filter((message) => message.createdAt >= input.since!);
  }
  if (input.cursor) {
    messages = messages.filter((message) => message.createdAt < input.cursor!);
  }
  messages = messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const hasMore = messages.length > limit;
  const data = hasMore ? messages.slice(-limit) : messages;
  return {
    data,
    hasMore,
    nextCursor: hasMore && data[0] ? data[0].createdAt : undefined,
  };
}

function matchesQuery(content: string, query: string): boolean {
  const haystack = content.toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
