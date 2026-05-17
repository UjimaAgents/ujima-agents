import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiErrorSchema } from '@ujima/api-schema';
import {
  AttachmentSchema,
  IdSchema,
  type AttachmentCategory,
} from '@ujima/shared';
import type { AuthService } from '@ujima/orchestrator';
import type { Repository } from '@ujima/runtime-core';
import { readSessionToken } from '../session-token.js';
import { apiError, errorMessage } from './route-errors.js';

const FILE_LIMIT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_PARAMS_SCHEMA = z.object({ attachmentId: IdSchema });
const ORGANIZATION_QUERY_SCHEMA = z.object({ organizationId: IdSchema });

export interface AttachmentRoutesOptions {
  repo: Repository;
  auth: AuthService;
}

export function registerAttachmentRoutes(
  _app: FastifyInstance,
  options: AttachmentRoutesOptions,
): void {
  const { repo, auth } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.post('/attachments', {
    schema: {
      description: 'Upload a file attachment',
      tags: ['Attachments'],
      response: {
        200: AttachmentSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        413: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = auth.getAuthState(readSessionToken(req));
      if (!authState.member) {
        return apiError(reply, 401, 'Session required');
      }

      let organizationId = '';
      let file: AttachmentUpload | undefined;
      let data: Buffer | undefined;
      for await (const part of req.parts() as AsyncIterable<AttachmentUpload | AttachmentField>) {
        if (part.type === 'file' && part.fieldname === 'file') {
          file = part;
          data = await readUploadFile(part);
          continue;
        }
        if (part.type === 'field' && part.fieldname === 'organizationId') {
          organizationId = String(part.value ?? '').trim();
        }
      }

      if (!organizationId || !file) {
        return apiError(reply, 400, 'Invalid attachment upload request.');
      }
      if (authState.user?.organizationId !== organizationId) {
        return apiError(reply, 403, 'Unauthorized for this organization.');
      }

      if (!data) {
        return apiError(reply, 400, 'Invalid attachment upload request.');
      }
      if (file.truncated) {
        return apiError(reply, 413, 'Attachment exceeds the 25 MB limit.');
      }
      if (data.length > FILE_LIMIT_BYTES) {
        return apiError(reply, 413, 'Attachment exceeds the 25 MB limit.');
      }

      const attachmentId = randomUUID();
      const filename = sanitizeFilename(file.filename);
      const storagePath = join(organizationId, attachmentId, filename);
      const absolutePath = resolveAttachmentPath(storagePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, data);
      try {
        return repo.saveAttachment(AttachmentSchema.parse({
          id: attachmentId,
          organizationId,
          filename,
          mimeType: file.mimetype || 'application/octet-stream',
          category: deriveCategory(file.mimetype),
          sizeBytes: data.length,
          storagePath,
          uploadedBy: authState.member.id,
          createdAt: new Date().toISOString(),
        }));
      } catch (saveError) {
        try {
          unlinkSync(absolutePath);
        } catch {
          // best-effort cleanup
        }
        throw saveError;
      }
    } catch (err) {
      if (isUploadTooLargeError(err)) {
        return apiError(reply, 413, 'Attachment exceeds the 25 MB limit.');
      }
      return apiError(reply, 400, errorMessage(err) || 'Unable to upload attachment.');
    }
  });

  app.get('/attachments/:attachmentId', {
    schema: {
      description: 'Download an attachment',
      tags: ['Attachments'],
      params: ATTACHMENT_PARAMS_SCHEMA,
      querystring: ORGANIZATION_QUERY_SCHEMA,
    },
  }, async (req, reply) => {
    return serveAttachment(repo, auth, readSessionToken(req), req.params.attachmentId, req.query.organizationId, reply, false);
  });

  app.get('/attachments/:attachmentId/thumbnail', {
    schema: {
      description: 'Fetch an image attachment for inline display',
      tags: ['Attachments'],
      params: ATTACHMENT_PARAMS_SCHEMA,
      querystring: ORGANIZATION_QUERY_SCHEMA,
    },
  }, async (req, reply) => {
    return serveAttachment(repo, auth, readSessionToken(req), req.params.attachmentId, req.query.organizationId, reply, true);
  });
}

async function serveAttachment(
  repo: Repository,
  auth: AuthService,
  sessionToken: string | undefined,
  attachmentId: string,
  organizationId: string,
  reply: FastifyReply,
  thumbnail: boolean,
): Promise<FastifyReply> {
  const authState = auth.getAuthState(sessionToken);
  if (!authState.member) {
    return apiError(reply, 401, 'Session required');
  }
  if (authState.user?.organizationId !== organizationId) {
    return apiError(reply, 403, 'Unauthorized for this organization.');
  }

  const attachment = repo.getAttachment(organizationId, attachmentId);
  if (!attachment) {
    return apiError(reply, 404, 'Attachment not found.');
  }
  if (thumbnail && attachment.category !== 'image') {
    return reply.code(204).send();
  }

  const path = resolveAttachmentPath(attachment.storagePath);
  if (!existsSync(path)) {
    return apiError(reply, 404, 'Attachment not found.');
  }
  const data = readFileSync(path);
  return reply
    .header('Content-Type', attachment.mimeType)
    .header('Content-Disposition', thumbnail ? `inline; filename="${escapeHeaderValue(attachment.filename)}"` : `attachment; filename="${escapeHeaderValue(attachment.filename)}"`)
    .send(data);
}

interface AttachmentUpload {
  type: 'file';
  fieldname: string;
  filename: string;
  mimetype: string;
  truncated?: boolean;
  file: AsyncIterable<Buffer | string>;
}

interface AttachmentField {
  type: 'field';
  fieldname: string;
  value: string | Buffer | undefined;
}

function isUploadTooLargeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('limit');
}

async function readUploadFile(file: AttachmentUpload): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of file.file) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > FILE_LIMIT_BYTES) {
      throw new Error('Attachment exceeds the 25 MB limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function resolveHomeDir(): string {
  const fromEnv = process.env.UJIMA_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(homedir(), '.ujima');
}

function resolveAttachmentPath(storagePath: string): string {
  return join(resolveHomeDir(), 'attachments', storagePath);
}

function sanitizeFilename(filename: string): string {
  const base = basename(filename).replaceAll('\0', '').trim();
  return base && base !== '.' && base !== '..' ? base : 'file';
}

function deriveCategory(mimeType: string): AttachmentCategory {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/pdf' ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  ) {
    return 'document';
  }
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/gzip' ||
    mimeType === 'application/x-7z-compressed'
  ) {
    return 'archive';
  }
  return 'other';
}

function escapeHeaderValue(value: string): string {
  return value.replaceAll('"', "'").replaceAll('\n', '').replaceAll('\r', '');
}
