// Resolve attachment refs (channel.reply / .post / .dm
// `attachments`) into materialised rows the conversation service
// can attach to a message.
//
// Four refTypes:
//   tool_call      — `tc_<callId>:<index>` from auto-capture
//   base64         — inline bytes, 1 MB cap
//   workspace_path — single file under workspace_root, copied in
//   workspace_glob — pattern under workspace_root, 10-file / 20 MB cap
//
// Each writes a row into both `agent_attachments` AND the existing
// message attachment table, sharing one on-disk file.

import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { AgentAttachment, AttachmentCategory } from '@ujima/shared';
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
  /**
   * True when this resolver created the agent_attachments row +
   * file from scratch (base64 / workspace_path / workspace_glob).
   * False when the row + file were already owned by a previous
   * capture pass and this resolver only added a user-attachment
   * row (tool_call). The publish-failure rollback path in
   * channel.* uses this flag: it must NOT delete the source
   * artifact for borrowed tool_call refs, otherwise retries
   * become impossible.
   */
  ownsAgentAttachmentRow: boolean;
}

export interface AttachmentResolverDeps {
  // All deletion methods are REQUIRED — the rollback paths in
  // commitBytes and resolveToolCallRef register them as undos
  // before each write, so making them optional would silently
  // bypass the cleanup contract for any test stub that forgot to
  // wire them. Tests must stub them explicitly.
  repo: Pick<
    ApiRepository,
    | 'findAgentAttachmentByToolCall'
    | 'saveAgentAttachment'
    | 'pinAgentAttachmentToMessage'
    | 'getAgentAttachment'
    | 'saveAttachment'
    | 'deleteAttachment'
    | 'deleteAgentAttachment'
  >;
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
 * Resolve agent-supplied refs into materialised rows. Returns rows
 * BEFORE message creation — the caller pins them after sendMessage
 * via pinAgentAttachmentToMessage. Any failure returns a structured
 * error rather than throwing.
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

  // Rollback handles. If a later ref fails, walk in reverse and
  // undo each. tool_call refs leave filePath/agentAttachmentId
  // empty because the underlying file belongs to the capture pass,
  // not us.
  const rollbacks: {
    filePath?: string;
    agentAttachmentId?: string;
    userAttachmentId: string;
  }[] = [];

  const failWithRollback = (err: ResolveResultErr): ResolveResultErr => {
    // Reverse order so later writes (which might depend on earlier
    // ones) get undone first. All operations are best-effort —
    // failures here log but don't surface, since the caller already
    // saw the original failure.
    for (let i = rollbacks.length - 1; i >= 0; i -= 1) {
      const handle = rollbacks[i];
      if (!handle) continue;
      if (handle.filePath) {
        try {
          rmSync(handle.filePath, { force: true });
        } catch (e) {
          console.warn('[agent-attachment-resolver] rollback file delete failed', handle.filePath, e);
        }
      }
      if (handle.agentAttachmentId) {
        try {
          deps.repo.deleteAgentAttachment(deps.organizationId, handle.agentAttachmentId);
        } catch (e) {
          console.warn('[agent-attachment-resolver] rollback agent_attachments delete failed', handle.agentAttachmentId, e);
        }
      }
      try {
        deps.repo.deleteAttachment(deps.organizationId, handle.userAttachmentId);
      } catch (e) {
        console.warn('[agent-attachment-resolver] rollback attachments delete failed', handle.userAttachmentId, e);
      }
    }
    return err;
  };

  for (const ref of refs) {
    if (ref.refType === 'tool_call') {
      const result = resolveToolCallRef(deps, ref, newAttId, newNow);
      if (!result.ok) return failWithRollback(result);
      rollbacks.push({ userAttachmentId: result.materialization.attachmentId });
      materializations.push(result.materialization);
      continue;
    }
    if (ref.refType === 'base64') {
      const result = resolveBase64Ref(deps, ref, newId, newAttId, newNow);
      if (!result.ok) return failWithRollback(result);
      rollbacks.push({
        filePath: result.absolutePath,
        agentAttachmentId: result.materialization.agentAttachmentId,
        userAttachmentId: result.materialization.attachmentId,
      });
      materializations.push(result.materialization);
      continue;
    }
    if (ref.refType === 'workspace_path') {
      const result = resolveWorkspacePathRef(deps, ref, newId, newAttId, newNow);
      if (!result.ok) return failWithRollback(result);
      rollbacks.push({
        filePath: result.absolutePath,
        agentAttachmentId: result.materialization.agentAttachmentId,
        userAttachmentId: result.materialization.attachmentId,
      });
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
      if (!result.ok) return failWithRollback(result);
      for (let i = 0; i < result.materializations.length; i += 1) {
        const m = result.materializations[i];
        if (!m) continue;
        const path = result.absolutePaths[i];
        rollbacks.push({
          ...(path ? { filePath: path } : {}),
          agentAttachmentId: m.agentAttachmentId,
          userAttachmentId: m.attachmentId,
        });
      }
      materializations.push(...result.materializations);
      continue;
    }
  }
  return { ok: true, materializations };
}

interface SingleOk {
  ok: true;
  materialization: ResolvedAttachmentMaterialization;
  /**
   * Absolute on-disk path the resolver wrote, if any. tool_call refs
   * have no file write (they reuse the captured file) so this is
   * undefined for those. Surface for rollback bookkeeping only.
   */
  absolutePath?: string;
}
interface MultiOk {
  ok: true;
  materializations: ResolvedAttachmentMaterialization[];
  /** Per-materialisation absolute paths, parallel to materializations. */
  absolutePaths: (string | undefined)[];
}
type SingleResult = SingleOk | ResolveResultErr;
type MultiResult = MultiOk | ResolveResultErr;

/**
 * Local commit/rollback primitive shared across every ref branch
 * (tool_call's user-row write, base64/workspace_*'s file + agent
 * row + user row sequence). Each side effect calls `register(undo)`
 * BEFORE the operation that produces it, so a throw inside the op
 * still unwinds the registered undo idempotently. `runRollback`
 * walks the stack in reverse, swallowing per-step failures so one
 * bad undo doesn't strand the rest.
 *
 * Returns an object instead of two free functions so the call site
 * keeps the stack scoped to this materialization rather than a
 * module-level singleton.
 */
/**
 * Single user-attachment row commit step. Used by EVERY ref branch
 * (tool_call as the only step, base64 / workspace_* as the final
 * step after the file write + agent_attachments insert). Registers
 * the rollback undo BEFORE the saveAttachment call so a partial
 * write inside the DB layer still gets cleaned up idempotently.
 */
function commitUserAttachmentRow(
  deps: AttachmentResolverDeps,
  register: (undo: () => void) => void,
  runRollback: () => void,
  args: {
    attachmentId: string;
    filename: string;
    mimeType: string;
    category: AttachmentCategory;
    sizeBytes: number;
    storagePath: string;
    createdAt: string;
    errorPrefix: string;
  },
): { ok: true } | ResolveResultErr {
  register(() => deps.repo.deleteAttachment(deps.organizationId, args.attachmentId));
  try {
    deps.repo.saveAttachment({
      id: args.attachmentId,
      organizationId: deps.organizationId,
      filename: args.filename,
      mimeType: args.mimeType,
      category: args.category,
      sizeBytes: args.sizeBytes,
      storagePath: args.storagePath,
      uploadedBy: deps.memberId,
      createdAt: args.createdAt,
    });
  } catch (err) {
    runRollback();
    return {
      ok: false,
      error: `${args.errorPrefix}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true };
}

function createRefCommitUndoStack(): {
  register: (undo: () => void) => void;
  runRollback: () => void;
} {
  const stack: (() => void)[] = [];
  return {
    register(undo) {
      stack.push(undo);
    },
    runRollback() {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        try {
          stack[i]?.();
        } catch (e) {
          console.warn('[agent-attachment-resolver] rollback step failed', e);
        }
      }
    },
  };
}

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
  // Same commit/rollback contract base64 / workspace_path /
  // workspace_glob use. The user-attachment row is the only
  // resolver-owned side effect on this branch — the file +
  // agent_attachments row belong to the capture pass.
  const { register, runRollback } = createRefCommitUndoStack();
  const attachmentId = newAttId();
  const committed = commitUserAttachmentRow(deps, register, runRollback, {
    attachmentId,
    filename: ref.filename ?? row.filename,
    mimeType: row.mimeType,
    category: row.category,
    sizeBytes: row.byteSize,
    storagePath: row.storagePath,
    createdAt: newNow(),
    errorPrefix: `tool_call ref "${ref.value}" attachments insert failed`,
  });
  if (!committed.ok) return committed;
  return {
    ok: true,
    materialization: {
      attachmentId,
      agentAttachmentId: row.id,
      filename: ref.filename ?? row.filename,
      mimeType: row.mimeType,
      category: row.category,
      byteSize: row.byteSize,
      // The row + file belong to the capture pass that produced
      // them; this resolver only added the user-attachment row.
      ownsAgentAttachmentRow: false,
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
  const absolutePaths: (string | undefined)[] = [];
  // Inner-loop rollback: the outer resolveAttachmentRefs only sees
  // this function's single `{ok:false}` return, so undo earlier
  // iterations locally before returning.
  const rollbackEarlier = (): void => {
    for (let i = materializations.length - 1; i >= 0; i -= 1) {
      const m = materializations[i];
      const path = absolutePaths[i];
      if (!m) continue;
      if (path) {
        try {
          rmSync(path, { force: true });
        } catch (e) {
          console.warn(
            '[agent-attachment-resolver] glob rollback file delete failed',
            path,
            e,
          );
        }
      }
      if (m.agentAttachmentId) {
        try {
          deps.repo.deleteAgentAttachment(deps.organizationId, m.agentAttachmentId);
        } catch (e) {
          console.warn(
            '[agent-attachment-resolver] glob rollback agent_attachments delete failed',
            m.agentAttachmentId,
            e,
          );
        }
      }
      try {
        deps.repo.deleteAttachment(deps.organizationId, m.attachmentId);
      } catch (e) {
        console.warn(
          '[agent-attachment-resolver] glob rollback attachments delete failed',
          m.attachmentId,
          e,
        );
      }
    }
  };
  for (const rel of matches) {
    const result = resolveWorkspacePathRef(
      deps,
      { refType: 'workspace_path', value: rel },
      newAgentId,
      newAttId,
      newNow,
    );
    if (!result.ok) {
      rollbackEarlier();
      return result;
    }
    cumulativeBytes += result.materialization.byteSize;
    if (cumulativeBytes > WORKSPACE_GLOB_BYTES_CAP) {
      // Roll back the iteration that just succeeded (this one is
      // already in `result`) AND every earlier one.
      try {
        if (result.absolutePath) rmSync(result.absolutePath, { force: true });
      } catch {
        // already logged via rollbackEarlier semantics
      }
      try {
        deps.repo.deleteAgentAttachment(
          deps.organizationId,
          result.materialization.agentAttachmentId,
        );
      } catch {
        // silent — best-effort cleanup
      }
      try {
        deps.repo.deleteAttachment(deps.organizationId, result.materialization.attachmentId);
      } catch {
        // silent
      }
      rollbackEarlier();
      return {
        ok: false,
        error: `workspace_glob combined size exceeds ${WORKSPACE_GLOB_BYTES_CAP} bytes (cap reached at ${cumulativeBytes}); narrow the pattern`,
      };
    }
    materializations.push(result.materialization);
    absolutePaths.push(result.absolutePath);
  }
  return { ok: true, materializations, absolutePaths };
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
  // The string-prefix check above doesn't catch symlinks:
  // readFileSync would follow them and exfiltrate arbitrary host
  // bytes. lstat catches direct symlinks (and works even when the
  // target doesn't exist); realpath catches symlinked parent dirs.
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch {
    // File doesn't exist — caller handles ENOENT downstream.
    return { ok: true, absolutePath };
  }
  if (stat.isSymbolicLink()) {
    return {
      ok: false,
      error: `workspace_path "${relative}" is a symlink — symlinks are not allowed for attachment refs`,
    };
  }
  try {
    const realPath = realpathSync(absolutePath);
    const realRoot = realpathSync(rootResolved);
    if (realPath !== realRoot && !realPath.startsWith(realRoot + '/')) {
      return {
        ok: false,
        error: `workspace_path "${relative}" resolves outside workspace_root via symlinked parent directory`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `workspace_path "${relative}" symlink check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
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
  // Shared commit/rollback contract with resolveToolCallRef. Each
  // step registers its undo BEFORE the next step's side effect so
  // a throw later in the sequence still cleans up earlier work.
  const { register, runRollback } = createRefCommitUndoStack();
  try {
    mkdirSync(absolutePath.split('/').slice(0, -1).join('/'), { recursive: true });
    writeFileSync(absolutePath, bytes);
    register(() => {
      try {
        rmSync(absolutePath, { force: true });
      } catch (e) {
        console.warn('[agent-attachment-resolver] file rollback failed', absolutePath, e);
      }
    });
  } catch (err) {
    runRollback();
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
  register(() => deps.repo.deleteAgentAttachment(deps.organizationId, id));
  try {
    deps.repo.saveAgentAttachment(agentRow);
  } catch (err) {
    runRollback();
    return { ok: false, error: `agent_attachments insert failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  // Audit emit fires after the user-attachment row succeeds so a
  // failed materialization doesn't produce a `created` event.
  const attachmentId = newAttId();
  const committed = commitUserAttachmentRow(deps, register, runRollback, {
    attachmentId,
    filename,
    mimeType,
    category,
    sizeBytes: bytes.length,
    storagePath: storageRelative,
    createdAt: newNow(),
    errorPrefix: 'attachments insert failed',
  });
  if (!committed.ok) return committed;
  // Audit is best-effort. A throw here must not bubble out and
  // bypass the rollback path — the file + rows are already
  // committed successfully and the caller expects {ok:true}.
  try {
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
  } catch (err) {
    console.warn(
      '[agent-attachment-resolver] commitBytes audit emit failed',
      id,
      err,
    );
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
      // commitBytes wrote the row + file fresh, so the publish
      // failure rollback path may safely delete both.
      ownsAgentAttachmentRow: true,
    },
    absolutePath,
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
    let dirents;
    try {
      dirents = readdirSync(resolvePath(root, relativeDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const name = dirent.name;
      if (name.startsWith('.')) continue;
      const rel = relativeDir.length === 0 ? name : `${relativeDir}/${name}`;
      // Skip symlinks (file or dir) so the walker can't recurse
      // outside the workspace.
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        walk(rel);
        if (matches.length >= cap) return;
      } else if (dirent.isFile() && regex.test(rel)) {
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
