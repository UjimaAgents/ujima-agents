// Agent-attachment auto-capture (agent_attachments_plan.md §3.2).
//
// Hooks the MCP tool-result pipeline: when a tool returns a structured
// result containing image / document bytes, the daemon writes them
// into the agent_attachments store and surfaces `attachment_refs` in
// the tool's structured output. The agent then references those refs
// (short identifiers like `tc_<callId>:0`) in channel.reply's
// `attachments` param — no base64 round-trip through the model.
//
// Three signals drive the capture decision:
//   1. Mime detection on the payload — the safe default.
//   2. Registry entry's `capturesAttachments` hint:
//        ['image']  → capture even if mime detection is ambiguous
//        'never'    → skip even if mime detection succeeds
//   3. Per-attachment caps (size, total quota).
//
// The hint is a MODIFIER, not the gate. Default behaviour is mime
// detection; registry entries can widen (for known generators like
// Playwright) or narrow (for known non-image MCPs like fetch).

import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
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
 * Pick out base64-encoded blobs from a tool result. MCPs vary in how
 * they encode images:
 *   * Anthropic-style content arrays with `{ type: 'image', source: {
 *       type: 'base64', data, mediaType } }`
 *   * Tagged objects: `{ data: '...', mimeType: 'image/png' }`
 *   * Raw base64 strings under common keys like `image`, `screenshot`,
 *     `bytes`.
 * Recursive walk + base64 sniff. Conservative: only payloads at
 * least 200 bytes get considered (avoids matching random hex/uuid
 * strings).
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
    // Anthropic content-array image shape
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
    // Generic { data, mimeType } shape
    if (
      typeof obj.data === 'string' &&
      typeof obj.mimeType === 'string' &&
      obj.mimeType.startsWith('image/')
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
  if (Array.isArray(hint) && hint.length > 0) {
    return {
      bytes: blob.bytes,
      mimeType: blob.declaredMime ?? 'application/octet-stream',
      category: hint[0] ?? 'image',
    };
  }
  return null;
}

export interface AttachmentCaptureDeps {
  repo: Pick<
    ApiRepository,
    'saveAgentAttachment' | 'sumAgentAttachmentBytes' | 'listExpiredUnpinnedAgentAttachments' | 'deleteAgentAttachment'
  >;
  /** Root under which agent-generated files live. Resolved at boot. */
  agentAttachmentRoot: string;
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
      for (const row of expired) {
        try {
          deps.repo.deleteAgentAttachment(input.organizationId, row.id);
        } catch (err) {
          console.warn('[agent-attachment-capture] cleanup row delete failed', err);
        }
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
    // storageRelative MUST be relative to `<home>/attachments/`, not
    // to agentAttachmentRoot. The web API resolves the column
    // against `<home>/attachments/<storagePath>` and would 404 on a
    // bare `<orgId>/<runId>/<id>.<ext>`. Include the
    // `agent-generated/` prefix so the same column works for both
    // writer (here) and reader (apps/api/.../attachments.ts).
    const storageRelative = join(
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
      refs.push({
        ref: `tc_${input.toolCallId}:${index}`,
        category: decision.category,
        filename,
        byteSize: decision.bytes.length,
      });
    } catch (err) {
      console.warn(
        `[agent-attachment-capture] DB write failed for ${input.toolCallId}:${index}`,
        err,
      );
      // Leave the file on disk; the next cleanup pass will skip it
      // because there's no row — orphaned-file detection lives in
      // the LRU job (Section E).
    }
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
    | 'listOrganizations'
    | 'listExpiredUnpinnedAgentAttachments'
    | 'deleteAgentAttachment'
  > & {
    // Just for the multi-org sweep: list every org so we can collect
    // expired rows. Optional fallback below if the host runs single-
    // org and didn't bother to list.
    listOrganizations?: () => { id: string }[];
  };
  agentAttachmentRoot: string;
  /** Hours after which unpinned rows are eligible for cleanup. */
  ttlHours?: number;
  /** Override for tests. */
  now?: () => Date;
}

/**
 * LRU cleanup pass over agent_attachments. Deletes the on-disk
 * file FIRST, then the row — so a crash between leaves a row
 * pointing at a missing file (recoverable / same as a transient
 * FS failure) rather than an orphaned file with no row.
 *
 * Best-effort throughout: per-row failures get logged and the
 * sweep keeps going. The scheduler tick that owns this can call
 * it without a try/catch wrapper.
 */
export function cleanupExpiredAgentAttachments(
  deps: AgentAttachmentCleanupDeps,
): { deletedRows: number; deletedBytes: number } {
  const ttlHours = deps.ttlHours ?? DEFAULT_LRU_TTL_HOURS;
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000).toISOString();
  const orgs = deps.repo.listOrganizations?.() ?? [];
  let deletedRows = 0;
  let deletedBytes = 0;
  for (const org of orgs) {
    const expired = deps.repo.listExpiredUnpinnedAgentAttachments(org.id, cutoff);
    for (const row of expired) {
      const absolutePath = `${deps.agentAttachmentRoot}/${row.storagePath}`;
      try {
        // Use rmSync to handle missing files without throwing —
        // already-gone files just collapse to a no-op (force=true).
        rmSync(absolutePath, { force: true });
      } catch (err) {
        console.warn(
          '[agent-attachment-cleanup] file delete failed',
          absolutePath,
          err,
        );
      }
      try {
        deps.repo.deleteAgentAttachment(org.id, row.id);
        deletedRows += 1;
        deletedBytes += row.byteSize;
      } catch (err) {
        console.warn(
          '[agent-attachment-cleanup] row delete failed',
          row.id,
          err,
        );
      }
    }
  }
  return { deletedRows, deletedBytes };
}
