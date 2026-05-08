import type { Message } from '@ujima/shared';

export const SELF_NOTE_SUMMARY_MARKER = '[[SELF_NOTE_SUMMARY_V1]]';
export const SELF_NOTE_COMPACTED_MARKER = '[[SELF_NOTE_COMPACTED_V1]]';

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
  if (input.marker) out.push(`${input.marker} ${input.title}`);
  else out.push(input.title);
  out.push('');
  for (const section of input.sections) {
    out.push(section.heading);
    for (const bullet of section.bullets) out.push(`- ${bullet}`);
    out.push('');
  }
  out.push('Important facts', ...lines, '', 'Stale or superseded items', '- Source notes in this batch are marked as compacted.');
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

function oneLine(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 280);
}
