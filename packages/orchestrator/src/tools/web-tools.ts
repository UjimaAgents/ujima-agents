import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import type { OrchestratorTool } from './types.js';

const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;

const FetchSchema = z.object({
  url: z.string().min(1),
  format: z.enum(['text', 'markdown', 'html']).default('text'),
  timeout: z.number().int().min(1).max(600).default(30),
});

const DownloadSchema = z.object({
  url: z.string().min(1),
  resourcePath: z.string().min(1),
  timeout: z.number().int().min(1).max(600).default(30),
});

export const fetchTool: OrchestratorTool<typeof FetchSchema> = {
  id: 'fetch',
  schema: FetchSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    input: args,
  }),
  execute: async ({ invocation }) => {
    const url = parseHttpUrl(String(invocation.input?.url ?? ''));
    const format = (invocation.input?.format as 'text' | 'markdown' | 'html' | undefined) ?? 'text';
    const timeoutSeconds = typeof invocation.input?.timeout === 'number' ? invocation.input.timeout : 30;
    const response = await fetchWithTimeout(url, timeoutSeconds);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      throw new Error(`Request failed with status code ${response.status}`);
    }

    const body = await readResponseText(response, FETCH_MAX_BYTES);
    return {
      url: url.toString(),
      format,
      status: response.status,
      contentType,
      content: body,
    };
  },
};

export const downloadTool: OrchestratorTool<typeof DownloadSchema> = {
  id: 'download',
  schema: DownloadSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'file',
    resourcePath: args.resourcePath,
    input: {
      url: args.url,
      timeout: args.timeout,
    },
  }),
  execute: async ({ invocation, team }) => {
    if (!invocation.resourcePath) {
      throw new Error('resourcePath is required');
    }

    const url = parseHttpUrl(String(invocation.input?.url ?? ''));
    const timeoutSeconds = typeof invocation.input?.timeout === 'number' ? invocation.input.timeout : 30;
    const resolved = assertWorkspaceBoundary(team.workspace.root, invocation.resourcePath);
    const response = await fetchWithTimeout(url, timeoutSeconds);
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      throw new Error(`Request failed with status code ${response.status}`);
    }

    const bytes = await readResponseBytes(response, DOWNLOAD_MAX_BYTES);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, bytes);

    return {
      success: true,
      path: resolved,
      bytesWritten: bytes.length,
      contentType,
    };
  },
};

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must start with http:// or https://');
  }
  return url;
}

async function fetchWithTimeout(url: URL, timeoutSeconds: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(timeoutSeconds, 600)) * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const bytes = await readResponseBytes(response, maxBytes);
  return new TextDecoder().decode(bytes);
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Response is too large (${bytes.byteLength} bytes). Maximum size is ${maxBytes} bytes`);
  }
  return bytes;
}
