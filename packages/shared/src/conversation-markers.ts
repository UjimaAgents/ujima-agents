export const SELF_NOTE_SUMMARY_MARKER = "[[SELF_NOTE_SUMMARY_V1]]";
export const SELF_NOTE_COMPACTED_MARKER = "[[SELF_NOTE_COMPACTED_V1]]";
export const CONVERSATION_SUMMARY_MARKER = "[[CONVERSATION_SUMMARY_V2]]";
export const CONVERSATION_SUMMARY_MARKER_V1 = "[[CONVERSATION_SUMMARY_V1]]";
export const CONVERSATION_COMPACTED_MARKER = "[[CONVERSATION_COMPACTED_V1]]";
export const CONVERSATION_ARCHIVE_MARKER = "[[CONVERSATION_ARCHIVE_V1]]";

export const CONVERSATION_ROLLING_SUMMARY_MARKERS = [
  CONVERSATION_SUMMARY_MARKER,
  CONVERSATION_SUMMARY_MARKER_V1,
  CONVERSATION_ARCHIVE_MARKER,
] as const;

export const CONVERSATION_COMPACTED_SOURCE_MARKERS = [
  CONVERSATION_COMPACTED_MARKER,
  CONVERSATION_ARCHIVE_MARKER,
] as const;

export function hasMessageMarker(content: string, marker: string): boolean {
  return content.startsWith(marker);
}

export function hasAnyMessageMarker(
  content: string,
  markers: readonly string[],
): boolean {
  return markers.some((marker) => content.startsWith(marker));
}

export function isSelfSummaryNoteContent(content: string): boolean {
  return hasMessageMarker(content, SELF_NOTE_SUMMARY_MARKER);
}

export function isCompactedSelfNoteContent(content: string): boolean {
  return hasMessageMarker(content, SELF_NOTE_COMPACTED_MARKER);
}

export function isConversationSummaryContent(content: string): boolean {
  return hasAnyMessageMarker(content, [CONVERSATION_SUMMARY_MARKER, CONVERSATION_SUMMARY_MARKER_V1]);
}

export function isCompactedConversationContent(content: string): boolean {
  return hasMessageMarker(content, CONVERSATION_COMPACTED_MARKER);
}

export function isArchivedConversationContent(content: string): boolean {
  return hasMessageMarker(content, CONVERSATION_ARCHIVE_MARKER);
}

export function isCompactionSummaryContent(content: string): boolean {
  return hasAnyMessageMarker(content, [
    ...CONVERSATION_ROLLING_SUMMARY_MARKERS,
    SELF_NOTE_SUMMARY_MARKER,
  ]);
}
