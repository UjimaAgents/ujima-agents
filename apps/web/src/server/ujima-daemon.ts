import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { BootstrapResponse, SessionAuthState, TeamSettingsResponse } from "@ujima/api-schema";
import type { RolePresetTemplate } from "@/features/onboarding/types";

export const WEB_SESSION_COOKIE = "ujima_web_session";
const DEFAULT_DAEMON_PORT = process.env.UJIMA_PORT ?? "7511";
const DAEMON_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.UJIMA_DAEMON_FETCH_TIMEOUT_MS ?? "5000",
  10,
);

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

export function readDaemonBearerToken(): string {
  const fromEnv = process.env.UJIMA_TOKEN;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const tokenPath = join(resolveHomeDir(), "token");
  try {
    return readFileSync(tokenPath, "utf8").trim();
  } catch {
    throw new DaemonRequestError(
      503,
      "ERR_DAEMON_TOKEN_MISSING",
      `Missing daemon token at ${tokenPath}. Run \`bun run dev:stack\` or \`ujima start\` so the API can issue a token.`,
    );
  }
}

export function sessionCookieOptions(expiresAt?: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.UJIMA_WEB_SECURE_COOKIES === "1",
    path: "/",
    expires: expiresAt ? new Date(expiresAt) : undefined,
  };
}

export async function getSessionTokenFromCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(WEB_SESSION_COOKIE)?.value;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: string): void {
  response.cookies.set(WEB_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(WEB_SESSION_COOKIE, "", {
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
  if (
    init.body !== undefined &&
    !(init.body instanceof FormData) &&
    !(init.body instanceof Blob) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }

  const url = `${daemonBaseUrl()}${path}`;
  const timeoutMs =
    Number.isFinite(DAEMON_FETCH_TIMEOUT_MS) && DAEMON_FETCH_TIMEOUT_MS > 0
      ? DAEMON_FETCH_TIMEOUT_MS
      : 5000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DaemonRequestError(
        503,
        "ERR_DAEMON_TIMEOUT",
        `Timed out reaching the Ujima daemon at ${url} after ${timeoutMs}ms. The API may still be starting — retry in a few seconds, or run \`bun run dev:stack\` instead of full \`bun run dev\`.`,
      );
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new DaemonRequestError(
      503,
      "ERR_DAEMON_UNAVAILABLE",
      `Unable to reach the Ujima daemon at ${url}. Run \`ujima start\` (npm install) or \`bun run dev:stack\` / \`bun run dev\` and ensure the API is listening on port ${DEFAULT_DAEMON_PORT}. (${reason})`,
    );
  } finally {
    clearTimeout(timeout);
  }
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

export async function requireOrgAccess(organizationId: string): Promise<SessionAuthState> {
  const authState = await getServerAuthState();
  if (!authState.authenticated) {
    throw new DaemonRequestError(401, "ERR_UNAUTHORIZED", "Session required");
  }
  if (authState.user?.organizationId !== organizationId) {
    throw new DaemonRequestError(403, "ERR_FORBIDDEN", "Unauthorized for this organization.");
  }
  return authState;
}

export async function getServerRolePresets(): Promise<RolePresetTemplate[]> {
  const response = await daemonJson<{ presets: RolePresetTemplate[] }>("/api/roles/presets");
  return response.presets;
}



export async function getServerTeamSettings(
  organizationId?: string,
): Promise<TeamSettingsResponse> {
  const path = organizationId
    ? `/api/settings/team?organizationId=${encodeURIComponent(organizationId)}`
    : "/api/settings/team";
  return daemonJson(path, {}, await getSessionTokenFromCookie());
}
