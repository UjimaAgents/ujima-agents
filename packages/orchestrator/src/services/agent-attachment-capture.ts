// Agent-attachment auto-capture: when an MCP tool returns image /
// document bytes, write them to the agent_attachments store and
// surface short `attachment_refs` on the tool result so the agent
// can pass them to channel.reply without round-tripping bytes.
//
// Capture decision = mime sniff first, registry hint modifies:
//   capturesAttachments: ['image'] → capture even if sniff is ambiguous
//   capturesAttachments: 'never'   → skip even if sniff succeeds

import { randomUUID } from 'node:crypto';
import { dirname, join, posix } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AgentAttachment, AttachmentCategory } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { ConnectorAuditWriter } from './connector-audit.js';

const DEFAULT_PER_FILE_CAP_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_PER_ORG_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GB

/**
 * Magic-byte sniffer for the common categories the multimodal
 * pipeline already supports. Conservative — when nothing matches,
 * returns null and the capture skips. Don't add MIME-by-suffix
 * heuristics here; rely on bytes so a renamed file can't slip past.
 */
export function sniffMimeAndCategory(
  bytes: Buffer | Uint8Array,
): { mimeType: string; category: AttachmentCategory } | null {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 4) return null;
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { mimeType: 'image/png', category: 'image' };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: 'image/jpeg', category: 'image' };
  }
  // GIF
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return { mimeType: 'image/gif', category: 'image' };
  }
  // WebP (RIFF....WEBP)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { mimeType: 'image/webp', category: 'image' };
  }
  // PDF
  if (
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46
  ) {
    return { mimeType: 'application/pdf', category: 'document' };
  }
  // SVG (XML opening tag) — text-detectable; emit explicitly so the
  // agent can attach SVG charts produced by a Playwright snapshot.
  if (buf.length >= 5) {
    const head = buf.slice(0, Math.min(buf.length, 200)).toString('utf8');
    if (head.includes('<svg')) {
      return { mimeType: 'image/svg+xml', category: 'image' };
    }
  }
  return null;
}

/**
 * Pick out base64-encoded binary blobs from a tool result. Handles
 * the three shapes MCPs commonly use:
 *   - Anthropic API: `{ type: 'image', source: { type: 'base64', data, mediaType } }`
 *   - MCP spec:      `{ type: 'image', data, mimeType? }` (no source wrapper)
 *   - Tagged:        `{ data, mimeType: 'image/...' | binary }`
 * Strings <200 bytes are skipped to avoid matching random hex/uuid
 * payloads.
 */
function extractCandidateBlobs(
  value: unknown,
  acc: { bytes: Buffer; declaredMime?: string }[] = [],
): { bytes: Buffer; declaredMime?: string }[] {
  if (typeof value === 'string') {
    if (value.length < 200) return acc;
    // base64 charset + (optional) data: prefix
    const stripped = value.startsWith('data:')
      ? value.split(',', 2)[1] ?? ''
      : value;
    if (!/^[A-Za-z0-9+/=]+$/.test(stripped.slice(0, 64))) return acc;
    try {
      const decoded = Buffer.from(stripped, 'base64');
      if (decoded.length >= 64) acc.push({ bytes: decoded });
    } catch {
      // not actually base64 — ignore
    }
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractCandidateBlobs(item, acc);
    return acc;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Anthropic API content-array image shape (with `source` wrapper).
    if (
      obj.type === 'image' &&
      obj.source &&
      typeof obj.source === 'object'
    ) {
      const source = obj.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string') {
        try {
          acc.push({
            bytes: Buffer.from(source.data, 'base64'),
            declaredMime:
              typeof source.mediaType === 'string' ? source.mediaType : undefined,
          });
        } catch {
          // ignore
        }
        return acc;
      }
    }
    // MCP spec image shape: mimeType is optional, the byte-sniffer
    // recovers mime from magic bytes when absent.
    if (obj.type === 'image' && typeof obj.data === 'string') {
      try {
        acc.push({
          bytes: Buffer.from(obj.data, 'base64'),
          declaredMime:
            typeof obj.mimeType === 'string' ? obj.mimeType : undefined,
        });
      } catch {
        // ignore
      }
      return acc;
    }
    // Generic { data, mimeType } binary blob. Exclude text/json/xml
    // so JSON tool results don't get base64-decoded.
    if (
      typeof obj.data === 'string' &&
      typeof obj.mimeType === 'string' &&
      !obj.mimeType.startsWith('text/') &&
      obj.mimeType !== 'application/json' &&
      obj.mimeType !== 'application/xml'
    ) {
      try {
        acc.push({
          bytes: Buffer.from(obj.data, 'base64'),
          declaredMime: obj.mimeType,
        });
      } catch {
        // ignore
      }
      return acc;
    }
    for (const child of Object.values(obj)) extractCandidateBlobs(child, acc);
  }
  return acc;
}

export interface CaptureDecision {
  bytes: Buffer;
  mimeType: string;
  category: AttachmentCategory;
}

/**
 * Apply the hybrid policy to one candidate blob.
 *   * `'never'` hint → skip.
 *   * Sniff bytes → if a known mime matches, capture (verified).
 *   * Sniff fails, hint widens (e.g. ['image']) → capture as the
 *     hint's first declared category, with `application/octet-stream`
 *     as the fallback mime so the multimodal pipeline doesn't choke.
 *   * No hint, no sniff match → skip.
 */
export function decideCapture(
  blob: { bytes: Buffer; declaredMime?: string },
  hint: 'never' | ('image' | 'document' | 'audio' | 'video')[] | undefined,
): CaptureDecision | null {
  if (hint === 'never') return null;
  const sniff = sniffMimeAndCategory(blob.bytes);
  if (sniff) return { bytes: blob.bytes, ...sniff };
  // Sniff failed. Two fallbacks: registry hint widens the net
  // (capture as the hint's first declared category), or declared
  // mime is recognisably binary (capture as the corresponding
  // category).
  if (Array.isArray(hint) && hint.length > 0) {
    return {
      bytes: blob.bytes,
      mimeType: blob.declaredMime ?? 'application/octet-stream',
      category: hint[0] ?? 'image',
    };
  }
  const declared = blob.declaredMime;
  if (declared) {
    const fromMime = categoryFromMime(declared);
    if (fromMime) {
      return { bytes: blob.bytes, mimeType: declared, category: fromMime };
    }
  }
  return null;
}

/**
 * Best-effort mime → category mapping for declared mime types the
 * byte sniffer doesn't recognise. Conservative — unknown mimes
 * fall through to null so capture skips rather than misclassify.
 */
function categoryFromMime(mime: string): AttachmentCategory | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (
    mime === 'application/pdf' ||
    mime === 'application/msword' ||
    mime.startsWith('application/vnd.openxmlformats-officedocument') ||
    mime.startsWith('application/vnd.ms-')
  ) {
    return 'document';
  }
  if (
    mime === 'application/zip' ||
    mime === 'application/x-tar' ||
    mime === 'application/gzip' ||
    mime === 'application/x-7z-compressed' ||
    mime === 'application/x-rar-compressed'
  ) {
    return 'archive';
  }
  return null;
}

export interface AttachmentCaptureDeps {
  repo: Pick<
    ApiRepository,
    'saveAgentAttachment' | 'sumAgentAttachmentBytes' | 'listExpiredUnpinnedAgentAttachments' | 'deleteAgentAttachment'
  >;
  /** Writer root: `<home>/attachments/agent-generated/`. */
  agentAttachmentRoot: string;
  /**
   * Canonical store root: `<home>/attachments/`. Used to construct
   * the absolute path of an expired row's file when reclaiming
   * space, so the file lifecycle matches the hourly sweeper.
   */
  attachmentStoreRoot: string;
  /** Optional audit writer — emits `agent_attachment_created` per row. */
  audit?: Pick<ConnectorAuditWriter, 'agentAttachmentCreated'>;
  /** Override for tests. Defaults to `aatt_<uuid>`. */
  generateId?: () => string;
  /** Override for tests. Defaults to `new Date().toISOString()`. */
  now?: () => string;
  /** Per-org quota in bytes. Default 1 GB. */
  perOrgQuotaBytes?: number;
  /** Per-file size cap in bytes. Default 10 MB. */
  perFileCapBytes?: number;
}

export interface AttachmentCaptureInput {
  organizationId: string;
  runId: string;
  memberId: string;
  serverId: string;
  toolName: string;
  toolCallId: string;
  toolResult: unknown;
  registryHint?:
    | 'never'
    | ('image' | 'document' | 'audio' | 'video')[];
}

export interface AttachmentCaptureResult {
  /** Refs the agent can pass to channel.reply's attachments param. */
  attachmentRefs: {
    ref: string;
    category: AttachmentCategory;
    filename: string;
    byteSize: number;
    usage_hint?: string;
  }[];
}

/**
 * Run capture for one tool result. Returns the refs to inject into
 * the structured output the agent sees. Never throws — capture
 * failures (FS errors, quota overflow, etc.) drop the bytes silently
 * and log a warn. The tool result reaches the agent regardless.
 */
export function captureToolResultAttachments(
  deps: AttachmentCaptureDeps,
  input: AttachmentCaptureInput,
): AttachmentCaptureResult {
  const refs: AttachmentCaptureResult['attachmentRefs'] = [];
  // Short-circuit for the 'never' hint without even iterating blobs.
  if (input.registryHint === 'never') {
    return { attachmentRefs: refs };
  }
  const newId = deps.generateId ?? (() => `aatt_${randomUUID()}`);
  const newNow = deps.now ?? (() => new Date().toISOString());
  const perFileCap = deps.perFileCapBytes ?? DEFAULT_PER_FILE_CAP_BYTES;
  const perOrgQuota = deps.perOrgQuotaBytes ?? DEFAULT_PER_ORG_QUOTA_BYTES;
  let index = 0;
  for (const blob of extractCandidateBlobs(input.toolResult)) {
    const decision = decideCapture(blob, input.registryHint);
    if (!decision) continue;
    if (decision.bytes.length > perFileCap) {
      console.warn(
        `[agent-attachment-capture] dropping ${decision.bytes.length}-byte blob from ${input.serverId}:${input.toolName} — exceeds ${perFileCap}-byte per-file cap`,
      );
      continue;
    }
    // Quota check. If the new bytes would push us over, run the
    // inline cleanup once and retry. Cleanup runs unpinned rows
    // older than 24h immediately (the per-run scheduler covers the
    // wider 4h default).
    const currentBytes = deps.repo.sumAgentAttachmentBytes(input.organizationId);
    if (currentBytes + decision.bytes.length > perOrgQuota) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const expired = deps.repo.listExpiredUnpinnedAgentAttachments(
        input.organizationId,
        cutoff,
      );
      // Same row+file cleanup the hourly sweeper uses.
      for (const row of expired) {
        deleteOneAgentAttachmentRowAndFile({
          row,
          repo: deps.repo,
          attachmentStoreRoot: deps.attachmentStoreRoot,
          organizationId: input.organizationId,
        });
      }
      const stillUsed = deps.repo.sumAgentAttachmentBytes(input.organizationId);
      if (stillUsed + decision.bytes.length > perOrgQuota) {
        console.warn(
          `[agent-attachment-capture] dropping blob from ${input.serverId}:${input.toolName} — org over ${perOrgQuota}-byte quota even after cleanup`,
        );
        continue;
      }
    }
    const id = newId();
    const extension = extensionForMime(decision.mimeType);
    // storageRelative must include the `agent-generated/` prefix so
    // the web API (which joins `<home>/attachments/` + storagePath)
    // resolves to the same on-disk file the writer below produces.
    const storageRelative = posix.join(
      'agent-generated',
      input.organizationId,
      input.runId,
      `${id}${extension}`,
    );
    // agentAttachmentRoot already points at `<home>/attachments/
    // agent-generated/`, so the on-disk path skips the prefix when
    // joined against the root.
    const absolutePath = join(
      deps.agentAttachmentRoot,
      input.organizationId,
      input.runId,
      `${id}${extension}`,
    );
    try {
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, decision.bytes);
    } catch (err) {
      console.warn(
        `[agent-attachment-capture] filesystem write failed for ${input.toolCallId}:${index}`,
        err,
      );
      continue;
    }
    const filename = filenameFor(
      input.serverId,
      input.toolName,
      index,
      extension,
    );
    // File first, then row. A throw between unwinds the file so
    // the sweeper isn't left chasing an orphan it can't enumerate.
    try {
      const row: AgentAttachment = {
        id,
        organizationId: input.organizationId,
        runId: input.runId,
        memberId: input.memberId,
        sourceToolCallId: input.toolCallId,
        sourceServerId: input.serverId,
        sourceToolName: input.toolName,
        category: decision.category,
        mimeType: decision.mimeType,
        filename,
        storagePath: storageRelative,
        byteSize: decision.bytes.length,
        createdAt: newNow(),
        pinnedToMessageId: null,
      };
      deps.repo.saveAgentAttachment(row);
    } catch (err) {
      console.warn(
        `[agent-attachment-capture] DB write failed for ${input.toolCallId}:${index} — rolling back the on-disk file`,
        err,
      );
      try {
        rmSync(absolutePath, { force: true });
      } catch (rmErr) {
        console.warn(
          `[agent-attachment-capture] rollback file unlink failed for ${input.toolCallId}:${index}`,
          rmErr,
        );
      }
      continue;
    }
    // Audit fires after the row commits so a failed capture never
    // emits a spurious `created` event. Best-effort — failures
    // here don't undo the capture.
    try {
      deps.audit?.agentAttachmentCreated({
        organizationId: input.organizationId,
        actorMemberId: input.memberId,
        runId: input.runId,
        attachmentId: id,
        category: decision.category,
        mimeType: decision.mimeType,
        byteSize: decision.bytes.length,
        source: 'tool_capture',
        toolCallId: input.toolCallId,
        serverId: input.serverId,
        toolName: input.toolName,
      });
    } catch (auditErr) {
      console.warn(
        `[agent-attachment-capture] audit emit failed for ${input.toolCallId}:${index}`,
        auditErr,
      );
    }
    refs.push({
      ref: `tc_${input.toolCallId}:${index}`,
      category: decision.category,
      filename,
      byteSize: decision.bytes.length,
      // Surface the directive inside the tool result so the model
      // sees it the moment it reads the refs, not many turns later
      // when it reaches the channel.* schema.
      usage_hint:
        `Already captured. To send this in a chat message, call ` +
        `channel.reply (or channel.post / channel.dm) with attachments: ` +
        `[{ refType: "tool_call", value: "tc_${input.toolCallId}:${index}" }]. ` +
        `Do NOT save these bytes to a workspace file first.`,
    });
    index += 1;
  }
  return { attachmentRefs: refs };
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

function filenameFor(
  serverId: string,
  toolName: string,
  index: number,
  extension: string,
): string {
  // Sanitised, human-readable label. Cap each segment so the
  // overall filename stays short enough for any filesystem.
  const safeServer = serverId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return `${safeServer || 'server'}-${safeTool || 'tool'}-${index}${extension}`;
}

const DEFAULT_LRU_TTL_HOURS = 4;

export interface AgentAttachmentCleanupDeps {
  repo: Pick<
    ApiRepository,
    'listExpiredUnpinnedAgentAttachments' | 'deleteAgentAttachment'
  >;
  /**
   * Org IDs to sweep. The caller is responsible for sourcing this
   * — typically `repo.listOrganizations().map(o => o.id)` in
   * production, an explicit fixture list in tests. Pulling it
   * inside this function used to require listOrganizations on the
   * repo Pick, which silently produced an empty sweep when a
   * partial stub forgot to wire it.
   */
  organizationIds: string[];
  /** `<home>/attachments/` — same root the web API resolves against. */
  attachmentStoreRoot: string;
  /** Hours after which unpinned rows are eligible for cleanup. */
  ttlHours?: number;
  /** Override for tests. */
  now?: () => Date;
}

/**
 * Delete the on-disk file BEFORE the row. A crash between leaves
 * a row pointing at a missing file (recoverable as a transient FS
 * error) rather than an orphaned file with no row to enumerate.
 * Returns bytes freed on success, 0 if the row delete failed.
 */
export function deleteOneAgentAttachmentRowAndFile(input: {
  row: AgentAttachment;
  repo: Pick<ApiRepository, 'deleteAgentAttachment'>;
  attachmentStoreRoot: string;
  organizationId: string;
}): number {
  const absolutePath = `${input.attachmentStoreRoot}/${input.row.storagePath}`;
  try {
    rmSync(absolutePath, { force: true });
  } catch (err) {
    console.warn(
      '[agent-attachment-cleanup] file delete failed',
      absolutePath,
      err,
    );
  }
  try {
    input.repo.deleteAgentAttachment(input.organizationId, input.row.id);
    return input.row.byteSize;
  } catch (err) {
    console.warn(
      '[agent-attachment-cleanup] row delete failed',
      input.row.id,
      err,
    );
    return 0;
  }
}

export function cleanupExpiredAgentAttachments(
  deps: AgentAttachmentCleanupDeps,
): { deletedRows: number; deletedBytes: number } {
  const ttlHours = deps.ttlHours ?? DEFAULT_LRU_TTL_HOURS;
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000).toISOString();
  let deletedRows = 0;
  let deletedBytes = 0;
  for (const organizationId of deps.organizationIds) {
    const expired = deps.repo.listExpiredUnpinnedAgentAttachments(organizationId, cutoff);
    for (const row of expired) {
      const freedBytes = deleteOneAgentAttachmentRowAndFile({
        row,
        repo: deps.repo,
        attachmentStoreRoot: deps.attachmentStoreRoot,
        organizationId,
      });
      if (freedBytes > 0) {
        deletedRows += 1;
        deletedBytes += freedBytes;
      }
    }
  }
  return { deletedRows, deletedBytes };
}
