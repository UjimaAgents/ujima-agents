import { mkdir, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { resolveBinaryPath, CURL_BINARY } from './binary-resolver.js';
import type { OrchestratorTool } from './types.js';

const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;

const FetchSchema = z.object({
  url: z.string().min(1),
  format: z.enum(['text', 'markdown', 'html']).default('text'),
  timeout: z.number().int().min(1).max(600).default(30),
  file_path: z.string().min(1).optional(),
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

// ── Fetch Tool ────────────────────────────────────────────────────

export const fetchTool: OrchestratorTool<typeof FetchSchema> = {
  id: 'fetch',
  schema: FetchSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    input: args,
  }),
  execute: async ({ invocation, team }) => {
    const url = parseHttpUrl(String(invocation.input?.url ?? ''));
    const timeoutSeconds = typeof invocation.input?.timeout === 'number' ? invocation.input.timeout : 30;
    const filePath = typeof invocation.input?.file_path === 'string' ? invocation.input.file_path : '';

    if (filePath) {
      const maxBytes = DOWNLOAD_MAX_BYTES;
      const { status, contentType, stderr, body } = await curlFetch(url, timeoutSeconds, maxBytes);
      if (status >= 400) {
        throw new Error(`Request failed with status code ${status}${stderr ? ': ' + stderr.slice(0, 200) : ''}`);
      }
      const resolved = assertWorkspaceBoundary(team!.workspace.root, filePath);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, body);
      return {
        url: url.toString(),
        status,
        contentType,
        bytesWritten: body.byteLength,
        path: resolved,
      };
    }

    const format = (invocation.input?.format as 'text' | 'markdown' | 'html' | undefined) ?? 'text';
    const { status, contentType, stderr, body } = await curlFetch(url, timeoutSeconds, FETCH_MAX_BYTES);
    if (status >= 400) {
      throw new Error(`Request failed with status code ${status}${stderr ? ': ' + stderr.slice(0, 200) : ''}`);
    }
    return {
      url: url.toString(),
      format,
      status,
      contentType,
      content: body.toString('utf8'),
    };
  },
};

// ── Download Tool (backward-compat wrapper) ────────────────────────

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

    const { status, contentType, stderr, body } = await curlFetch(url, timeoutSeconds, DOWNLOAD_MAX_BYTES);
    if (status >= 400) {
      throw new Error(`Request failed with status code ${status}${stderr ? ': ' + stderr.slice(0, 200) : ''}`);
    }

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, body);

    return {
      success: true,
      path: resolved,
      bytesWritten: body.byteLength,
      contentType,
    };
  },
};

// ── Curl HTTP Helper ──────────────────────────────────────────────

interface CurlResult {
  status: number;
  contentType: string;
  stderr: string;
  body: Buffer;
}

async function curlFetch(url: URL, timeoutSeconds: number, maxBytes: number): Promise<CurlResult> {
  // SSRF check (security boundary — keep in Node, not curl)
  await assertPublicEgressUrl(url);

  const bin = resolveBinaryPath(CURL_BINARY, 'CURL_BIN_PATH');
  const timeoutMs = Math.max(1, Math.min(timeoutSeconds, 600));

  // -sS: silent but show errors on stderr
  // -L: follow redirects (default max 50)
  // -i: include response headers in stdout
  // --max-time: timeout in seconds
  // --max-filesize: max bytes curl will download
  const args = [
    '-sS',
    '-L',
    '-i',
    '--max-time', String(timeoutMs),
    '--max-filesize', String(maxBytes),
    '--',
    url.toString(),
  ];

  const result = await new Promise<{ stdout: Buffer; stderr: string }>((resolve, _reject) => {
    execFile(
      bin,
      args,
      { maxBuffer: maxBytes + 65536, encoding: 'buffer' },
      (err, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? '');
        const errText = typeof stderr === 'string' ? stderr : stderr?.toString('utf8') ?? '';
        if (err) {
          // curl exits non-zero on server errors, timeouts, etc.
          // The stderr usually has the error message; we still want stdout for the body if we got one
          resolve({ stdout: out, stderr: errText });
          return;
        }
        resolve({ stdout: out, stderr: errText });
      },
    );
  });

  // Split headers from body — curl -i outputs headers first, then \r\n\r\n, then body
  const headerSeparator = Buffer.from('\r\n\r\n');
  const separator = result.stdout.indexOf(headerSeparator);
  const headerBlock =
    separator === -1 ? '' : result.stdout.subarray(0, separator).toString('utf8');
  const body =
    separator === -1 ? result.stdout : result.stdout.subarray(separator + headerSeparator.length);

  // Parse status code from "HTTP/1.1 200 OK" or "HTTP/2 200"
  const statusLine = headerBlock.match(/HTTP\/\S+\s+(\d+)/);
  const status = statusLine ? Number(statusLine[1]) : 0;

  // Parse content-type
  const ctMatch = headerBlock.match(/content-type:\s*(\S+)/i);
  const contentType = ctMatch ? (ctMatch[1] ?? '').replace(/;.*$/, '').trim() : '';

  if (body.byteLength > maxBytes) {
    throw new Error(`Response is too large (${body.byteLength} bytes). Maximum size is ${maxBytes} bytes`);
  }

  return {
    status,
    contentType,
    stderr: result.stderr,
    body,
  };
}

// ── URL / SSRF helpers (unchanged from Node implementation) ───────

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must start with http:// or https://');
  }
  return url;
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
    ? [{ address: host } as { address: string }]
    : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('URL resolves to a private or link-local address');
  }
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
