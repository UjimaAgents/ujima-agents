import { mkdir, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { z } from 'zod';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import type { OrchestratorTool } from './types.js';

const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const FetchSchema = z.object({
  url: z.string().min(1),
  format: z.enum(['text', 'markdown', 'html']).default('text'),
  timeout: z.number().int().min(1).max(600).default(30),
});

// Schema-facing field is `file_path` (matches workspace tools) so
// Gemini doesn't see `resourcePath` anywhere in any palette and
// misapply it to channel.* / self.* via additionalProperties:false.
// No resourcePath alias-back-compat: Zod strips unknown keys
// before our helper runs, so a caller passing `resourcePath` would
// already fail validation regardless.
const DownloadSchema = z.object({
  url: z.string().min(1),
  file_path: z.string().min(1).optional(),
  timeout: z.number().int().min(1).max(600).default(30),
});

function downloadPathFrom(args: { file_path?: string }): string {
  return typeof args.file_path === 'string' ? args.file_path : '';
}

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
    resourcePath: downloadPathFrom(args),
    input: {
      url: args.url,
      timeout: args.timeout,
    },
  }),
  execute: async ({ invocation, team }) => {
    if (!invocation.resourcePath) {
      throw new Error('file_path is required (the destination workspace file path)');
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
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicEgressUrl(current);
    const controller = new AbortController();
    const timeoutMs = Math.max(1, Math.min(timeoutSeconds, 600)) * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current, { signal: controller.signal, redirect: 'manual' });
      if (!isRedirect(response.status)) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      current = parseHttpUrl(new URL(location, current).toString());
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Too many redirects');
}

async function assertPublicEgressUrl(url: URL): Promise<void> {
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed');
  }

  const host = url.hostname.toLowerCase();
  if (isBlockedHostname(host)) {
    throw new Error('URL host is not allowed');
  }

  const directIp = isIP(host);
  const addresses = directIp
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('URL resolves to a private or link-local address');
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isBlockedHostname(host: string): boolean {
  return (
    host === 'localhost' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  );
}

function isPrivateAddress(address: string): boolean {
  const mappedV4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedV4) return isPrivateV4(mappedV4);
  if (isIP(address) === 4) return isPrivateV4(address);
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
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
