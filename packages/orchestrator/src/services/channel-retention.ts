import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { decodeCursor, encodeCursor, type Message, type MessageMention } from '@ujima/shared';
import type { ArchivedChannelMessageStore } from './conversation.js';
import type { ApiRepository, PaginatedMessages } from './repository-reader.js';

// `IdSchema` only requires a non-empty string, so a config-defined channel
// name like `../../tmp/pwn` (or any value containing path separators) would
// otherwise let `appendFile` / `readdir` operate on attacker-chosen
// filesystem locations outside `archiveRoot`.
function safeArchiveSegment(segment: string, label: string): string {
  if (!segment) {
    throw new Error(`channel-retention: ${label} cannot be empty`);
  }
  if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
    throw new Error(
      `channel-retention: ${label} contains an illegal path separator: ${JSON.stringify(segment)}`,
    );
  }
  if (segment === '.' || segment === '..' || segment.startsWith('.')) {
    throw new Error(
      `channel-retention: ${label} cannot start with "." or be a relative path component: ${JSON.stringify(segment)}`,
    );
  }
  return segment;
}

function archiveChannelDir(
  archiveRoot: string,
  organizationId: string,
  channelId: string,
): string {
  // Channel ids like "general" are reused across organizations, so the
  // archive layout must be org-scoped to avoid cross-org history leakage.
  const safeOrg = safeArchiveSegment(organizationId, 'organizationId');
  const safeChannel = safeArchiveSegment(channelId, 'channelId');
  const archivesBase = resolve(archiveRoot, 'archives', 'channels');
  const channelDir = resolve(archivesBase, safeOrg, safeChannel);
  // Defence in depth: even after segment sanitization, assert the resolved
  // path lives strictly under `<archiveRoot>/archives/channels/`. Catches
  // anything the segment guard misses (symlink shenanigans, future regex
  // weakening, etc.).
  if (channelDir !== archivesBase && !channelDir.startsWith(archivesBase + sep)) {
    throw new Error(
      `channel-retention: archive path escape detected for ${organizationId}/${channelId}`,
    );
  }
  return channelDir;
}

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
        await this.appendArchivedRecord(organizationId, channel.id, {
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
    const records = await this.loadArchivedRecords(input.organizationId, input.channelId);
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
    const records = await this.loadArchivedRecords(input.organizationId, input.channelId);
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
    organizationId: string,
    channelId: string,
    record: ArchivedMessageRecord,
  ): Promise<void> {
    const month = record.message.createdAt.slice(0, 7);
    const channelDir = archiveChannelDir(this.archiveRoot, organizationId, channelId);
    await mkdir(channelDir, { recursive: true });
    const jsonlPath = join(channelDir, `${month}.jsonl`);
    const indexPath = join(channelDir, `${month}.index.json`);

    await appendFile(jsonlPath, `${JSON.stringify(record)}\n`, 'utf8');

    // The JSONL file is the durable append-only archive. The sidecar index keeps
    // archived reads simple for now so channel.read(query=...) can continue to
    // work without having to stream and parse every monthly log on each query.
    const existing = await readJsonArray<ArchivedMessageRecord>(indexPath);
    existing.push(record);
    await writeFile(indexPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  }

  private async loadArchivedRecords(
    organizationId: string,
    channelId: string,
  ): Promise<ArchivedMessageRecord[]> {
    let channelDir: string;
    try {
      channelDir = archiveChannelDir(this.archiveRoot, organizationId, channelId);
    } catch {
      // An untrusted channel id with path separators reaches here only via
      // a malformed read request; treat it like "no archive exists".
      return [];
    }
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
    const since = input.since;
    messages = messages.filter((message) => message.createdAt >= since);
  }
  // Composite cursor: same shape as the SQL paginators. Without the id
  // tiebreaker, two archived messages sharing the same millisecond
  // timestamp would skip one of them on the page boundary.
  const decoded = decodeCursor(input.cursor);
  if (decoded) {
    const { timestamp, id } = decoded;
    messages = messages.filter((message) => {
      if (message.createdAt < timestamp) return true;
      if (id !== undefined && message.createdAt === timestamp && message.id < id) return true;
      return false;
    });
  }
  messages = messages.sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
  const hasMore = messages.length > limit;
  const data = hasMore ? messages.slice(-limit) : messages;
  const head = hasMore && data[0] ? data[0] : undefined;
  return {
    data,
    hasMore,
    nextCursor: head ? encodeCursor(head.createdAt, head.id) : undefined,
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
