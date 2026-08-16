export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
  }
  return fallback;
}

export async function clientFetchJson<T>(
  url: string,
  init: RequestInit = {},
  fallbackMessage = "Request failed",
): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ClientApiError(messageFromBody(body, fallbackMessage), response.status, body);
  }
  return body as T;
}

export async function clientFetchVoid(
  url: string,
  init: RequestInit = {},
  fallbackMessage = "Request failed",
): Promise<void> {
  const response = await fetch(url, init);
  if (response.ok || response.status === 204) return;
  const body = await response.json().catch(() => null);
  throw new ClientApiError(messageFromBody(body, fallbackMessage), response.status, body);
}
