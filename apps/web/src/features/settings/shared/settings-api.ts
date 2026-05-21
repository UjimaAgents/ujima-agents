export function parseApiError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
}

export async function readResponseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export async function settingsFetch<T>(
  url: string,
  init?: RequestInit,
  fallbackMessage = "Request failed",
): Promise<T> {
  const response = await fetch(url, init);
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(parseApiError(body, fallbackMessage));
  }
  return body as T;
}

export async function settingsFetchVoid(
  url: string,
  init?: RequestInit,
  fallbackMessage = "Request failed",
): Promise<void> {
  const response = await fetch(url, init);
  if (response.ok || response.status === 204) return;
  const body = await readResponseJson(response);
  throw new Error(parseApiError(body, fallbackMessage));
}
