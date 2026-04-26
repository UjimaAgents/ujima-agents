import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:7511";
const TOKEN_FILENAME = "token";

function resolveRepoRoot() {
  return resolve(process.cwd(), "..", "..");
}

function resolveCandidateHomes() {
  const repoRoot = resolveRepoRoot();

  return [
    process.env.UJIMA_HOME,
    resolve(repoRoot, ".ujima-dev-home"),
    join(homedir(), ".ujima"),
  ].filter((value): value is string => Boolean(value));
}

function readBearerToken() {
  for (const homeDir of resolveCandidateHomes()) {
    const tokenPath = join(homeDir, TOKEN_FILENAME);

    if (!existsSync(tokenPath)) {
      continue;
    }

    const token = readFileSync(tokenPath, "utf8").trim();

    if (token.length > 0) {
      return token;
    }
  }

  throw new Error("Unable to locate a Ujima API bearer token.");
}

export function resolveUjimaApiBaseUrl() {
  return process.env.UJIMA_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export async function fetchUjimaApi(pathname: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${readBearerToken()}`);
  headers.set("Accept", "application/json");

  const response = await fetch(`${resolveUjimaApiBaseUrl()}${pathname}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  return response;
}
