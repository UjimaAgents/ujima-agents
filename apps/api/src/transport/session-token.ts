import type { FastifyRequest } from './server.js';

export function readSessionToken(req: FastifyRequest): string | undefined {
  const raw = req.headers['x-ujima-session'];
  if (Array.isArray(raw)) {
    return raw.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
  }
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}
