type Row = Record<string, unknown>;

export function now() {
  return new Date().toISOString();
}

export function rowString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string column "${key}"`);
  }

  return value;
}

export function optionalRowString(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseJsonObject(value: unknown): Record<string, string[]> {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, string[]>;
}

export function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

