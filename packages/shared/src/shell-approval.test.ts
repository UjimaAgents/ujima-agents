import { describe, expect, it } from 'vitest';
import {
  normalizeOrgShellApprovalMode,
  resolveEffectiveShellApprovalMode,
  shellApprovalModeFromLegacyRequireShell,
} from './shell-approval.js';

describe('shellApprovalModeFromLegacyRequireShell', () => {
  it('maps legacy boolean to modes', () => {
    expect(shellApprovalModeFromLegacyRequireShell(true)).toBe('always_review');
    expect(shellApprovalModeFromLegacyRequireShell(false)).toBe('allow_all');
    expect(shellApprovalModeFromLegacyRequireShell(undefined)).toBe('always_review');
  });
});

describe('normalizeOrgShellApprovalMode', () => {
  it('prefers explicit shellApprovalMode', () => {
    expect(
      normalizeOrgShellApprovalMode({
        shellApprovalMode: 'auto_review',
        requireApprovalForShell: false,
      }),
    ).toBe('auto_review');
  });
});

describe('resolveEffectiveShellApprovalMode', () => {
  it('forces auto_review when goal mode is active', () => {
    expect(
      resolveEffectiveShellApprovalMode({
        orgMode: 'always_review',
        memberMode: 'allow_all',
        goalModeActive: true,
      }),
    ).toBe('auto_review');
  });

  it('uses member override when not goal mode', () => {
    expect(
      resolveEffectiveShellApprovalMode({
        orgMode: 'always_review',
        memberMode: 'allow_all',
        goalModeActive: false,
      }),
    ).toBe('allow_all');
  });

  it('falls back to org when member inherits', () => {
    expect(
      resolveEffectiveShellApprovalMode({
        orgMode: 'auto_review',
        memberMode: 'inherit',
        goalModeActive: false,
      }),
    ).toBe('auto_review');
  });
});
