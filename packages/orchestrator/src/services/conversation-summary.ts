import type { Message } from '@ujima/shared';

export const SELF_NOTE_SUMMARY_MARKER = '[[SELF_NOTE_SUMMARY_V1]]';
export const SELF_NOTE_COMPACTED_MARKER = '[[SELF_NOTE_COMPACTED_V1]]';
export const CONVERSATION_SUMMARY_MARKER = '[[CONVERSATION_SUMMARY_V1]]';
export const CONVERSATION_COMPACTED_MARKER = '[[CONVERSATION_COMPACTED_V1]]';
export const CONVERSATION_ARCHIVE_MARKER = '[[CONVERSATION_ARCHIVE_V1]]';
const README_SUMMARY_GUIDANCE = [
  '> README-style compact summary. Keep this concise, skimmable, and focused on durable context.',
  '> It is okay to forget details that are not important.',
] as const;

export function formatTimestampedContent(content: string, createdAt: string): string {
  if (content.startsWith('[') && content.includes(' at ') && content.includes(']')) {
    return content;
  }
  return `[${toReadableEnglishTimestamp(createdAt)}]\n${content}`;
}

export function toReadableEnglishTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function isMessageWithMarker(message: Message, marker: string): boolean {
  return message.content.startsWith(marker);
}

export function isSelfSummaryNote(message: Message): boolean {
  return isMessageWithMarker(message, SELF_NOTE_SUMMARY_MARKER);
}

export function isCompactedSelfNote(message: Message): boolean {
  return isMessageWithMarker(message, SELF_NOTE_COMPACTED_MARKER);
}

export function isConversationSummary(message: Message): boolean {
  return isMessageWithMarker(message, CONVERSATION_SUMMARY_MARKER);
}

export function isCompactedConversation(message: Message): boolean {
  return isMessageWithMarker(message, CONVERSATION_COMPACTED_MARKER);
}

export function isArchivedConversation(message: Message): boolean {
  return isMessageWithMarker(message, CONVERSATION_ARCHIVE_MARKER);
}

export function buildStructuredConversationSummary(input: {
  marker?: string;
  title: string;
  messages: Message[];
  sections: { heading: string; bullets: string[] }[];
}): string {
  const lines = input.messages.map(
    (message) => `- ${toReadableEnglishTimestamp(message.createdAt)}: ${oneLine(message.content)}`,
  );
  const out: string[] = [];
  if (input.marker) out.push(`${input.marker} # ${input.title}`);
  else out.push(`# ${input.title}`);
  out.push('');
  out.push(...README_SUMMARY_GUIDANCE);
  out.push('');
  for (const section of input.sections) {
    out.push(`## ${section.heading}`);
    for (const bullet of section.bullets) out.push(`- ${bullet}`);
    out.push('');
  }
  out.push('## Important facts', ...lines, '', '## Stale or superseded items', '- Source notes in this batch are marked as compacted.');
  return out.join('\n');
}

export function buildSelfNoteSummary(messages: Message[]): string {
  return buildStructuredConversationSummary({
    marker: SELF_NOTE_SUMMARY_MARKER,
    title: `Compacted ${messages.length} earlier self notes.`,
    messages,
    sections: [
      {
        heading: 'Current goals',
        bullets: ['Keep recent self-note detail while preserving older memory as a concise summary.'],
      },
      {
        heading: 'Decisions',
        bullets: ['Auto-compaction runs when uncompacted self notes exceed threshold.'],
      },
      {
        heading: 'User preferences',
        bullets: ['Self-note reads should show human-readable timestamps while storage stays ISO.'],
      },
      {
        heading: 'Open questions',
        bullets: ['None captured in this compacted batch.'],
      },
    ],
  });
}

export function buildConversationSummary(messages: Message[]): string {
  return buildStructuredConversationSummary({
    marker: CONVERSATION_SUMMARY_MARKER,
    title: `Compacted ${messages.length} earlier messages.`,
    messages,
    sections: [
      {
        heading: 'Current discussion',
        bullets: ['Keep the recent raw window intact while older context is rolled into this summary.'],
      },
      {
        heading: 'Decisions',
        bullets: ['Older messages were compacted deterministically without model output.'],
      },
      {
        heading: 'Open questions',
        bullets: ['Review the live tail for the freshest replies and follow-ups.'],
      },
      {
        heading: 'Stale or superseded items',
        bullets: ['Source messages in this batch are marked as compacted.'],
      },
    ],
  });
}

export function buildConversationArchiveSummary(messages: Message[]): string {
  return buildStructuredConversationSummary({
    marker: CONVERSATION_ARCHIVE_MARKER,
    title: `Archived ${messages.length} earlier messages.`,
    messages,
    sections: [
      {
        heading: 'Current discussion',
        bullets: ['The visible conversation was cleared and rolled into archive form.'],
      },
      {
        heading: 'Decisions',
        bullets: ['This archive remains recoverable in the message store.'],
      },
      {
        heading: 'Open questions',
        bullets: ['Start a fresh thread if you want a clean surface.'],
      },
      {
        heading: 'Stale or superseded items',
        bullets: ['Source messages in this batch are marked as compacted or archived.'],
      },
    ],
  });
}

function oneLine(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 280);
}
