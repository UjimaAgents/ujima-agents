import { z } from 'zod';

export const ShellApprovalModeSchema = z.enum([
  'always_review',
  'auto_review',
  'allow_all',
]);
export type ShellApprovalMode = z.infer<typeof ShellApprovalModeSchema>;

export const MemberShellApprovalModeSchema = z.enum([
  'inherit',
  'always_review',
  'auto_review',
  'allow_all',
]);
export type MemberShellApprovalMode = z.infer<typeof MemberShellApprovalModeSchema>;

export function shellApprovalModeFromLegacyRequireShell(
  requireApprovalForShell: boolean | undefined,
): ShellApprovalMode {
  if (requireApprovalForShell === false) return 'allow_all';
  return 'always_review';
}

export function normalizeOrgShellApprovalMode(policies: {
  shellApprovalMode?: ShellApprovalMode;
  requireApprovalForShell?: boolean;
}): ShellApprovalMode {
  if (policies.shellApprovalMode) return policies.shellApprovalMode;
  return shellApprovalModeFromLegacyRequireShell(policies.requireApprovalForShell);
}

export function resolveEffectiveShellApprovalMode(input: {
  orgMode: ShellApprovalMode;
  memberMode?: MemberShellApprovalMode;
  goalModeActive: boolean;
}): ShellApprovalMode {
  if (input.goalModeActive) return 'auto_review';
  if (input.memberMode && input.memberMode !== 'inherit') return input.memberMode;
  return input.orgMode;
}
