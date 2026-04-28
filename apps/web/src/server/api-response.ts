import type { ApiError } from "@ujima/api-schema";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseApiError(
  body: unknown,
  fallbackMessage: string,
  fallbackCode: ApiError["code"] = "ERR_INTERNAL",
): ApiError {
  if (
    isObject(body) &&
    typeof body.code === "string" &&
    typeof body.message === "string"
  ) {
    return {
      code: body.code as ApiError["code"],
      message: body.message,
      details: isObject(body.details) ? body.details : undefined,
    };
  }

  return {
    code: fallbackCode,
    message: fallbackMessage,
  };
}

export function upstreamUnavailable(message: string): ApiError {
  return {
    code: "ERR_INTERNAL",
    message,
  };
}

export function stripSessionToken<T extends { sessionToken: string }>(body: T): Omit<T, "sessionToken"> {
  const { sessionToken, ...sanitized } = body;
  void sessionToken;
  return sanitized;
}

export function hasObjectProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return isObject(value) && key in value;
}
