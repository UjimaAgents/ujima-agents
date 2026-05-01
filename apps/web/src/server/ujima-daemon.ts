import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cookies } from "next/headers";
import type { BootstrapResponse, SessionAuthState } from "@ujima/api-schema";

export const WEB_SESSION_COOKIE = "ujima_web_session";
const DEFAULT_DAEMON_PORT = process.env.UJIMA_PORT ?? "7511";

interface DaemonErrorPayload {
  code?: string;
  message?: string;
}

export class DaemonRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function daemonBaseUrl(): string {
  return (process.env.UJIMA_API_URL ?? `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`).replace(/\/$/, "");
}

function resolveHomeDir(): string {
  const fromEnv = process.env.UJIMA_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(homedir(), ".ujima");
}

function readDaemonBearerToken(): string {
  const fromEnv = process.env.UJIMA_TOKEN;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  return readFileSync(join(resolveHomeDir(), "token"), "utf8").trim();
}

export function sessionCookieOptions(expiresAt?: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt ? new Date(expiresAt) : undefined,
  };
}

export async function getSessionTokenFromCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(WEB_SESSION_COOKIE)?.value;
}

export async function setSessionCookie(token: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  store.set(WEB_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(WEB_SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    expires: new Date(0),
  });
}

export async function daemonFetch(
  path: string,
  init: RequestInit = {},
  sessionToken?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${readDaemonBearerToken()}`);
  if (sessionToken) {
    // The browser never sees the daemon's machine token. The Next server
    // forwards the owner session separately so bootstrap/auth requests can be
    // resolved against the durable DB-backed session state.
    headers.set("x-ujima-session", sessionToken);
  }
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(`${daemonBaseUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export async function daemonJson<T>(
  path: string,
  init: RequestInit = {},
  sessionToken?: string,
): Promise<T> {
  const response = await daemonFetch(path, init, sessionToken);
  const body = (await response.json().catch(() => ({}))) as T | DaemonErrorPayload;

  if (!response.ok) {
    const payload = body as DaemonErrorPayload;
    throw new DaemonRequestError(
      response.status,
      payload.code ?? "ERR_INTERNAL",
      payload.message ?? `daemon request failed (${response.status})`,
    );
  }

  return body as T;
}

export async function getServerBootstrap(): Promise<BootstrapResponse> {
  return daemonJson<BootstrapResponse>("/api/bootstrap", {}, await getSessionTokenFromCookie());
}

export async function getServerAuthState(): Promise<SessionAuthState> {
  return daemonJson<SessionAuthState>("/api/auth/session", {}, await getSessionTokenFromCookie());
}
