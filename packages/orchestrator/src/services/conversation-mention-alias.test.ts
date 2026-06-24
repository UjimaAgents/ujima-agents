import { describe, expect, it } from 'vitest';
import {
  buildMentionHandleRegistry,
  scanMentionsInContent,
} from '@ujima/shared';
import {
  buildMemberMentionEntries,
  stripMentionSuffix,
} from './conversation.js';

// Resolve @-mention ids the same way ConversationService does: build the
// handle registry from member entries, then scan the message body.
function resolveIds(
  members: { id: string; name: string }[],
  content: string,
): string[] {
  const registry = buildMentionHandleRegistry(
    buildMemberMentionEntries(members, (m) => m.id),
  );
  scanMentionsInContent(content, registry, { allowAll: false });
  return [...registry.values];
}

const laylaReds = { id: 'm_reds', name: 'Layla Reds ( OSINT )' };
const laylaLane = { id: 'm_lane', name: 'Layla Lane' };
const aiden = { id: 'm_aiden', name: 'Aiden Ellis ( OSINT )' };

describe('stripMentionSuffix', () => {
  it('strips a trailing parenthetical suffix, leaves plain names alone', () => {
    expect(stripMentionSuffix('Layla Reds ( OSINT )')).toBe('Layla Reds');
    expect(stripMentionSuffix('Aiden Ellis (OSINT)')).toBe('Aiden Ellis');
    expect(stripMentionSuffix('Layla Lane')).toBe('Layla Lane');
  });
});

describe('mention resolution with suffix-stripped aliases', () => {
  it('resolves a bare "@Layla Reds" to the suffixed member', () => {
    // The live bug: "@Layla Reds run ..." produced mentions=[] because the
    // only handle was the full "Layla Reds ( OSINT )".
    expect(resolveIds([laylaReds, laylaLane, aiden], '@Layla Reds run a quick OSINT search')).toEqual(['m_reds']);
  });

  it('still resolves the full suffixed name', () => {
    expect(resolveIds([laylaReds], '@Layla Reds ( OSINT ) please look')).toEqual(['m_reds']);
  });

  it('does not cross-match the other Layla', () => {
    expect(resolveIds([laylaReds, laylaLane], '@Layla Lane ping')).toEqual(['m_lane']);
  });

  it('does NOT alias an ambiguous base shared by two suffixed members', () => {
    // Two members strip to the same base "Bob" → alias withheld, so a bare
    // "@Bob" resolves to neither rather than silently the wrong one.
    const bobOsint = { id: 'm_bo', name: 'Bob ( OSINT )' };
    const bobSales = { id: 'm_bs', name: 'Bob ( Sales )' };
    expect(resolveIds([bobOsint, bobSales], '@Bob take a look')).toEqual([]);
    // The fully-qualified names still resolve.
    expect(resolveIds([bobOsint, bobSales], '@Bob ( Sales ) take a look')).toEqual(['m_bs']);
  });

  it('does NOT let a suffixed member hijack a plain member with the same base name', () => {
    // "Layla Reds" (plain) + "Layla Reds ( OSINT )": the stripped base
    // collides with the plain member's FULL name, so the alias must be
    // withheld — bare "@Layla Reds" resolves to the plain member only.
    const plain = { id: 'm_plain', name: 'Layla Reds' };
    const osint = { id: 'm_osint', name: 'Layla Reds ( OSINT )' };
    expect(resolveIds([plain, osint], '@Layla Reds ping')).toEqual(['m_plain']);
    // The suffixed member is still reachable by its full name.
    expect(resolveIds([plain, osint], '@Layla Reds ( OSINT ) ping')).toEqual(['m_osint']);
  });
});
