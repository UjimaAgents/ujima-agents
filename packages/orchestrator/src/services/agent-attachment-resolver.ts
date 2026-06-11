// Agent-attachment ref resolver (agent_attachments_plan.md §3.3).
//
// channel.reply / channel.post / channel.dm accept an optional
// `attachments` array of refs. This module resolves each ref into
// a materialised attachment row that can be passed to
// sendMessage / sendDirectMessage / postToChannel via the existing
// attachmentIds parameter.
//
// Four refTypes the agent can pass:
//   * tool_call      — `tc_<callId>:<index>` referring to a row the
//                      auto-capture wrote.
//   * base64         — raw bytes inline. Capped at 1 MB.
//   * workspace_path — single file under the org's workspace_root.
//                      Copied into the agent-attachments store at
//                      attach time (so message immutability holds).
//   * workspace_glob — pattern under workspace_root. Capped at 10
//                      matched files / 20 MB combined.
//
// All four converge on writing a row into both `agent_attachments`
// (with pinned_to_message_id set) AND the existing user-attachment
// store so the message picks up an `attachment_id` row the
// frontend AttachmentGrid + toModelMessages pipeline already
// renders. The bytes live exactly once on disk — the
// message_attachments storagePath points at the same file the
// agent_attachments row owns.

import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import type { AgentAttachment, Attachment, AttachmentCategory } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { sniffMimeAndCategory } from './agent-attachment-capture.js';
import type { ConnectorAuditWriter } from './connector-audit.js';

const BASE64_INLINE_CAP_BYTES = 1 * 1024 * 1024; // 1 MB
const WORKSPACE_PATH_CAP_BYTES = 10 * 1024 * 1024; // 10 MB per file
const WORKSPACE_GLOB_FILE_CAP = 10;
const WORKSPACE_GLOB_BYTES_CAP = 20 * 1024 * 1024; // 20 MB combined

export interface AttachmentRefInput {
  refType: 'tool_call' | 'base64' | 'workspace_path' | 'workspace_glob';
  value: string;
  filename?: string;
  mimeType?: string;
}

export interface ResolvedAttachmentMaterialization {
  /** message_attachments id the message will point at. */
  attachmentId: string;
  /** agent_attachments id (also written). */
  agentAttachmentId: string;
  filename: string;
  mimeType: string;
  category: AttachmentCategory;
  byteSize: number;
}

export interface AttachmentResolverDeps {
  repo: Pick<
    ApiRepository,
    | 'findAgentAttachmentByToolCall'
    | 'saveAgentAttachment'
    | 'pinAgentAttachmentToMessage'
    | 'getAgentAttachment'
    | 'saveAttachment'
  > & {
    // The user-attachment writer (existing API). Different repos may
    // expose this under different names; the orchestrator's Repository
    // class has `saveAttachment`.
    saveAttachment?: (attachment: Attachment) => Attachment;
  };
  agentAttachmentRoot: string;
  /** Org workspace root, when known. Null when the org has no path set. */
  workspaceRoot: string | null;
  organizationId: string;
  runId: string;
  memberId: string;
  /** Audit emitter — fires `agent_attachment_created` per new row. */
  audit?: Pick<ConnectorAuditWriter, 'agentAttachmentCreated'>;
  /** Override for tests. */
  generateId?: () => string;
  /** Override for tests. */
  now?: () => string;
}

export interface ResolveResultOk {
  ok: true;
  materializations: ResolvedAttachmentMaterialization[];
}

export interface ResolveResultErr {
  ok: false;
  error: string;
}

export type ResolveAttachmentRefsResult = ResolveResultOk | ResolveResultErr;

/**
 * Resolve the agent-supplied refs into materialised attachment rows.
 * Returns the rows BEFORE the message is created — the channel tool
 * binds them to the message afterwards via pinAgentAttachmentToMessage
 * and the attachment_id thread through sendMessage. On any failure
 * (cap exceeded, path escape, missing tool-call row, ...) returns a
 * structured error so the agent gets a useful message rather than a
 * crashed run.
 *
 * Caller is responsible for the pinning step + the message_attachment
 * row write because both depend on the just-created message id.
 */
export async function resolveAttachmentRefs(
  deps: AttachmentResolverDeps,
  refs: AttachmentRefInput[],
): Promise<ResolveAttachmentRefsResult> {
  if (refs.length === 0) {
    return { ok: true, materializations: [] };
  }
  const newId = deps.generateId ?? (() => `aatt_${randomUUID()}`);
  const newAttId = deps.generateId ?? (() => `att_${randomUUID()}`);
  const newNow = deps.now ?? (() => new Date().toISOString());
  const materializations: ResolvedAttachmentMaterialization[] = [];

  for (const ref of refs) {
    if (ref.refType === 'tool_call') {
      const result = resolveToolCallRef(deps, ref, newAttId, newNow);
      if (!result.ok) return result;
      materializations.push(result.materialization);
      continue;
    }
    if (ref.refType === 'base64') {
      const result = resolveBase64Ref(deps, ref, newId, newAttId, newNow);
      if (!result.ok) return result;
      materializations.push(result.materialization);
      continue;
    }
    if (ref.refType === 'workspace_path') {
      const result = resolveWorkspacePathRef(deps, ref, newId, newAttId, newNow);
      if (!result.ok) return result;
      materializations.push(result.materialization);
      continue;
    }
    if (ref.refType === 'workspace_glob') {
      const result = await resolveWorkspaceGlobRef(
        deps,
        ref,
        newId,
        newAttId,
        newNow,
        materializations.length,
      );
      if (!result.ok) return result;
      materializations.push(...result.materializations);
      continue;
    }
  }
  return { ok: true, materializations };
}

interface SingleOk {
  ok: true;
  materialization: ResolvedAttachmentMaterialization;
}
interface MultiOk {
  ok: true;
  materializations: ResolvedAttachmentMaterialization[];
}
type SingleResult = SingleOk | ResolveResultErr;
type MultiResult = MultiOk | ResolveResultErr;

function resolveToolCallRef(
  deps: AttachmentResolverDeps,
  ref: AttachmentRefInput,
  newAttId: () => string,
  newNow: () => string,
): SingleResult {
  // Format: tc_<toolCallId>:<index>. We tolerate the `tc_` prefix
  // being absent for forward-compat with callers that strip it.
  const raw = ref.value.startsWith('tc_') ? ref.value.slice(3) : ref.value;
  const colon = raw.lastIndexOf(':');
  if (colon < 0) {
    return { ok: false, error: `tool_call ref "${ref.value}" is malformed; expected tc_<callId>:<index>` };
  }
  const callId = raw.slice(0, colon);
  const index = Number.parseInt(raw.slice(colon + 1), 10);
  if (!Number.isFinite(index) || index < 0) {
    return { ok: false, error: `tool_call ref "${ref.value}" has invalid index` };
  }
  const row = deps.repo.findAgentAttachmentByToolCall(
    deps.organizationId,
    callId,
    index,
  );
  if (!row) {
    return {
      ok: false,
      error: `tool_call ref "${ref.value}" resolves to no captured attachment (was the tool call successful, and did it return capturable bytes?)`,
    };
  }
  // The row already lives on disk; we just promote a parallel
  // message_attachments row pointing at the same storage_path.
  const attachmentId = newAttId();
  if (deps.repo.saveAttachment) {
    deps.repo.saveAttachment({
      id: attachmentId,
      organizationId: deps.organizationId,
      filename: ref.filename ?? row.filename,
      mimeType: row.mimeType,
      category: row.category,
      sizeBytes: row.byteSize,
      storagePath: row.storagePath,
      uploadedBy: deps.memberId,
      createdAt: newNow(),
    });
  }
  return {
    ok: true,
    materialization: {
      attachmentId,
      agentAttachmentId: row.id,
      filename: ref.filename ?? row.filename,
      mimeType: row.mimeType,
      category: row.category,
      byteSize: row.byteSize,
    },
  };
}

function resolveBase64Ref(
  deps: AttachmentResolverDeps,
  ref: AttachmentRefInput,
  newAgentId: () => string,
  newAttId: () => string,
  newNow: () => string,
): SingleResult {
  let bytes: Buffer;
  try {
    const stripped = ref.value.startsWith('data:')
      ? ref.value.split(',', 2)[1] ?? ''
      : ref.value;
    bytes = Buffer.from(stripped, 'base64');
  } catch (err) {
    return { ok: false, error: `base64 decode failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (bytes.length === 0) {
    return { ok: false, error: 'base64 ref decoded to zero bytes' };
  }
  if (bytes.length > BASE64_INLINE_CAP_BYTES) {
    return { ok: false, error: `base64 ref exceeds ${BASE64_INLINE_CAP_BYTES}-byte cap (got ${bytes.length})` };
  }
  const sniff = sniffMimeAndCategory(bytes);
  const mimeType = sniff?.mimeType ?? ref.mimeType ?? 'application/octet-stream';
  const category: AttachmentCategory = sniff?.category ?? 'other';
  return commitBytes(
    deps,
    bytes,
    mimeType,
    category,
    ref.filename ?? `inline-${Date.now()}${extensionForMime(mimeType)}`,
    newAgentId,
    newAttId,
    newNow,
    null,
  );
}

function resolveWorkspacePathRef(
  deps: AttachmentResolverDeps,
  ref: AttachmentRefInput,
  newAgentId: () => string,
  newAttId: () => string,
  newNow: () => string,
): SingleResult {
  const guard = guardWorkspacePath(deps.workspaceRoot, ref.value);
  if (!guard.ok) return guard;
  const absolutePath = guard.absolutePath;
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch (err) {
    return { ok: false, error: `workspace_path "${ref.value}" does not exist or is unreadable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `workspace_path "${ref.value}" is not a regular file` };
  }
  if (stat.size > WORKSPACE_PATH_CAP_BYTES) {
    return { ok: false, error: `workspace_path "${ref.value}" exceeds ${WORKSPACE_PATH_CAP_BYTES}-byte cap (got ${stat.size})` };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(absolutePath);
  } catch (err) {
    return { ok: false, error: `workspace_path read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const sniff = sniffMimeAndCategory(bytes);
  const mimeType = sniff?.mimeType ?? ref.mimeType ?? 'application/octet-stream';
  const category: AttachmentCategory = sniff?.category ?? 'other';
  const filename = ref.filename ?? ref.value.split('/').pop() ?? 'attachment';
  return commitBytes(
    deps,
    bytes,
    mimeType,
    category,
    filename,
    newAgentId,
    newAttId,
    newNow,
    null,
  );
}

async function resolveWorkspaceGlobRef(
  deps: AttachmentResolverDeps,
  ref: AttachmentRefInput,
  newAgentId: () => string,
  newAttId: () => string,
  newNow: () => string,
  _alreadyMaterialised: number,
): Promise<MultiResult> {
  if (!deps.workspaceRoot) {
    return { ok: false, error: 'workspace_glob requires a configured workspace_root on the organization' };
  }
  if (ref.value.includes('..')) {
    return { ok: false, error: 'workspace_glob may not contain ".." path segments' };
  }
  if (isAbsolute(ref.value)) {
    return { ok: false, error: 'workspace_glob must be a relative pattern under workspace_root' };
  }
  // Lightweight glob: supports the patterns operators actually
  // write (`*.png`, `screenshots/*.png`, `**/*.png`). Anything more
  // exotic should be narrowed by the agent. Walking is bounded by
  // the WORKSPACE_GLOB_FILE_CAP — we stop early.
  const matches = matchGlob(deps.workspaceRoot, ref.value, WORKSPACE_GLOB_FILE_CAP + 1);
  if (matches.length > WORKSPACE_GLOB_FILE_CAP) {
    return {
      ok: false,
      error: `workspace_glob matched more than ${WORKSPACE_GLOB_FILE_CAP} files (cap reached); narrow the pattern`,
    };
  }
  if (matches.length === 0) {
    return { ok: false, error: `workspace_glob "${ref.value}" matched no files` };
  }
  matches.sort();
  let cumulativeBytes = 0;
  const materializations: ResolvedAttachmentMaterialization[] = [];
  for (const rel of matches) {
    const result = resolveWorkspacePathRef(
      deps,
      { refType: 'workspace_path', value: rel },
      newAgentId,
      newAttId,
      newNow,
    );
    if (!result.ok) return result;
    cumulativeBytes += result.materialization.byteSize;
    if (cumulativeBytes > WORKSPACE_GLOB_BYTES_CAP) {
      return {
        ok: false,
        error: `workspace_glob combined size exceeds ${WORKSPACE_GLOB_BYTES_CAP} bytes (cap reached at ${cumulativeBytes}); narrow the pattern`,
      };
    }
    materializations.push(result.materialization);
  }
  return { ok: true, materializations };
}

function guardWorkspacePath(
  workspaceRoot: string | null,
  relative: string,
): { ok: true; absolutePath: string } | ResolveResultErr {
  if (!workspaceRoot) {
    return { ok: false, error: 'workspace_path requires a configured workspace_root on the organization' };
  }
  if (isAbsolute(relative)) {
    return { ok: false, error: 'workspace_path must be relative; got an absolute path' };
  }
  // Reject path traversal explicitly before resolve() collapses the
  // segments. A relative path that starts with `..` gets caught by
  // the containment check below, but an explicit reject is clearer
  // in the error message and surfaces the intent.
  if (relative.split('/').some((seg) => seg === '..')) {
    return { ok: false, error: 'workspace_path may not contain ".." segments' };
  }
  const absolutePath = resolvePath(workspaceRoot, relative);
  const rootResolved = resolvePath(workspaceRoot);
  if (
    absolutePath !== rootResolved &&
    !absolutePath.startsWith(rootResolved + '/')
  ) {
    return { ok: false, error: `workspace_path "${relative}" escapes workspace_root` };
  }
  return { ok: true, absolutePath };
}

function commitBytes(
  deps: AttachmentResolverDeps,
  bytes: Buffer,
  mimeType: string,
  category: AttachmentCategory,
  filename: string,
  newAgentId: () => string,
  newAttId: () => string,
  newNow: () => string,
  toolCallSource: { callId: string; serverId: string; toolName: string } | null,
): SingleResult {
  const id = newAgentId();
  // storageRelative MUST include the `agent-generated/` prefix so
  // the web API's resolveAttachmentPath (which prepends
  // `<home>/attachments/`) finds the file. See
  // agent-attachment-capture.ts for the matching invariant; both
  // sites must agree on the column shape.
  const fileName = `${id}${extensionForMime(mimeType)}`;
  const storageRelative = join(
    'agent-generated',
    deps.organizationId,
    deps.runId,
    fileName,
  );
  const absolutePath = join(
    deps.agentAttachmentRoot,
    deps.organizationId,
    deps.runId,
    fileName,
  );
  try {
    mkdirSync(absolutePath.split('/').slice(0, -1).join('/'), { recursive: true });
    writeFileSync(absolutePath, bytes);
  } catch (err) {
    return { ok: false, error: `failed to write attachment to store: ${err instanceof Error ? err.message : String(err)}` };
  }
  const agentRow: AgentAttachment = {
    id,
    organizationId: deps.organizationId,
    runId: deps.runId,
    memberId: deps.memberId,
    sourceToolCallId: toolCallSource?.callId ?? null,
    sourceServerId: toolCallSource?.serverId ?? null,
    sourceToolName: toolCallSource?.toolName ?? null,
    category,
    mimeType,
    filename,
    storagePath: storageRelative,
    byteSize: bytes.length,
    createdAt: newNow(),
    pinnedToMessageId: null,
  };
  try {
    deps.repo.saveAgentAttachment(agentRow);
  } catch (err) {
    return { ok: false, error: `agent_attachments insert failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  deps.audit?.agentAttachmentCreated({
    organizationId: deps.organizationId,
    actorMemberId: deps.memberId,
    runId: deps.runId,
    attachmentId: id,
    category,
    mimeType,
    byteSize: bytes.length,
    source: toolCallSource ? 'tool_capture' : 'agent_post',
    ...(toolCallSource?.callId ? { toolCallId: toolCallSource.callId } : {}),
    ...(toolCallSource?.serverId ? { serverId: toolCallSource.serverId } : {}),
    ...(toolCallSource?.toolName ? { toolName: toolCallSource.toolName } : {}),
  });
  const attachmentId = newAttId();
  if (deps.repo.saveAttachment) {
    deps.repo.saveAttachment({
      id: attachmentId,
      organizationId: deps.organizationId,
      filename,
      mimeType,
      category,
      sizeBytes: bytes.length,
      storagePath: storageRelative,
      uploadedBy: deps.memberId,
      createdAt: newNow(),
    });
  }
  return {
    ok: true,
    materialization: {
      attachmentId,
      agentAttachmentId: id,
      filename,
      mimeType,
      category,
      byteSize: bytes.length,
    },
  };
}

/**
 * Lightweight glob matcher with three patterns:
 *   `*` — any chars except `/` within one path segment
 *   `**` — any chars across path segments (greedy)
 *   `?` — single char except `/`
 * Returns matched paths relative to `root`, sorted, up to `cap`.
 * Walking is bounded — we stop scanning when we hit `cap + 1` so
 * the caller can detect the overflow without us reading the entire
 * tree. Hidden directories (starting with `.`) are skipped to keep
 * `**` from descending into `.git`, `node_modules`, etc.
 */
function matchGlob(root: string, pattern: string, cap: number): string[] {
  const regex = globToRegex(pattern);
  const matches: string[] = [];
  const walk = (relativeDir: string): void => {
    if (matches.length >= cap) return;
    let entries: string[];
    try {
      entries = readdirSync(resolvePath(root, relativeDir), { withFileTypes: true }).map(
        (e) => `${e.name}${e.isDirectory() ? '/' : ''}`,
      );
    } catch {
      return;
    }
    for (const entry of entries) {
      const isDir = entry.endsWith('/');
      const name = isDir ? entry.slice(0, -1) : entry;
      if (name.startsWith('.')) continue;
      const rel = relativeDir.length === 0 ? name : `${relativeDir}/${name}`;
      if (isDir) {
        walk(rel);
        if (matches.length >= cap) return;
      } else if (regex.test(rel)) {
        matches.push(rel);
        if (matches.length >= cap) return;
      }
    }
  };
  walk('');
  matches.sort();
  return matches;
}

function globToRegex(pattern: string): RegExp {
  let regex = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      // ** — any chars including slashes
      regex += '.*';
      i += 2;
      if (pattern[i] === '/') i += 1;
    } else if (c === '*') {
      // * — any chars except /
      regex += '[^/]*';
      i += 1;
    } else if (c === '?') {
      regex += '[^/]';
      i += 1;
    } else if (c === '.' || c === '+' || c === '(' || c === ')' || c === '|' || c === '^' || c === '$') {
      regex += `\\${c}`;
      i += 1;
    } else {
      regex += c;
      i += 1;
    }
  }
  regex += '$';
  return new RegExp(regex);
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    case 'application/pdf':
      return '.pdf';
    default:
      return '.bin';
  }
}
