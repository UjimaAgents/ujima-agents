import { z } from 'zod';
import type { OrchestratorTool } from './types.js';

const DEFAULT_LIMIT = 5;
const SEARCH_TIMEOUT_MS = 8000;

export const WebSearchSchema = z.object({
  query: z.string().min(1),
  site: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).default(DEFAULT_LIMIT),
});

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank: number;
}

type WebSearchState =
  | {
      status: 'streaming';
      query: string;
      site?: string;
      source: string;
      results: WebSearchResult[];
    }
  | {
      status: 'completed';
      query: string;
      site?: string;
      source: string;
      results: WebSearchResult[];
    };

export const webSearchTool: OrchestratorTool<typeof WebSearchSchema> = {
  id: 'web_search',
  schema: WebSearchSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    input: args,
  }),
  execute: async ({ invocation, reportProgress }) => {
    const query = String(invocation.input.query).trim();
    const site = typeof invocation.input.site === 'string' ? invocation.input.site.trim() : '';
    const limit = typeof invocation.input.limit === 'number' ? invocation.input.limit : DEFAULT_LIMIT;
    const effectiveQuery = buildQuery(query, site);

    const primary = await searchPrimary({ query: effectiveQuery, limit });
    if (primary.length > 0) {
      await streamResults({
        query,
        site: site || undefined,
        source: 'primary',
        results: primary,
        reportProgress,
      });
      return completedPayload(query, site, 'primary', primary);
    }

    const fallback = await searchDuckDuckGo({ query: effectiveQuery, limit });
    await streamResults({
      query,
      site: site || undefined,
      source: 'duckduckgo',
      results: fallback,
      reportProgress,
    });
    return completedPayload(query, site, 'duckduckgo', fallback);
  },
};

async function streamResults(input: {
  query: string;
  site?: string;
  source: string;
  results: WebSearchResult[];
  reportProgress?: (output: unknown) => Promise<void> | void;
}) {
  if (!input.reportProgress) return;
  const streamed: WebSearchResult[] = [];
  for (const result of input.results) {
    streamed.push(result);
    await input.reportProgress({
      status: 'streaming',
      query: input.query,
      ...(input.site ? { site: input.site } : {}),
      source: input.source,
      results: [...streamed],
    } satisfies WebSearchState);
    await Promise.resolve();
  }
}

function completedPayload(
  query: string,
  site: string,
  source: string,
  results: WebSearchResult[],
): WebSearchState {
  return {
    status: 'completed',
    query,
    ...(site ? { site } : {}),
    source,
    results,
  };
}

function buildQuery(query: string, site: string): string {
  return site ? `${query} site:${site}` : query;
}

async function searchPrimary(input: {
  query: string;
  limit: number;
}): Promise<WebSearchResult[]> {
  const endpoint = process.env.WEB_SEARCH_PRIMARY_URL?.trim();
  if (!endpoint) return [];

  const url = new URL(endpoint);
  url.searchParams.set('q', input.query);
  url.searchParams.set('limit', String(input.limit));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: buildPrimaryHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as unknown;
    return normalizePrimaryResults(data, input.limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function buildPrimaryHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const apiKey = process.env.WEB_SEARCH_PRIMARY_API_KEY?.trim();
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function normalizePrimaryResults(data: unknown, limit: number): WebSearchResult[] {
  const items = extractResultArray(data);
  return items.slice(0, limit).map((item, index) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    source: 'primary',
    rank: index + 1,
  }));
}

function extractResultArray(data: unknown): { title: string; url: string; snippet: string }[] {
  const record = isRecord(data) ? data : undefined;
  const arrays = [
    record?.results,
    record?.items,
    record?.organic_results,
  ];
  for (const value of arrays) {
    if (!Array.isArray(value)) continue;
    const items = value
      .map((entry) => toResult(entry))
      .filter((entry): entry is { title: string; url: string; snippet: string } => !!entry);
    if (items.length > 0) return items;
  }
  return [];
}

async function searchDuckDuckGo(input: {
  query: string;
  limit: number;
}): Promise<WebSearchResult[]> {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', input.query);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseDuckDuckGoHtml(html, input.limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks = html.match(/<div class="result[^>]*>[\s\S]*?<\/div>\s*<\/div>/g) ?? [];
  for (const block of blocks) {
    const titleMatch =
      block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) ??
      block.match(/<a[^>]*href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const url = normalizeDuckDuckGoUrl(decodeHtml(titleMatch[1] ?? ''));
    const title = stripTags(decodeHtml(titleMatch[2] ?? ''));
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = stripTags(decodeHtml(snippetMatch?.[1] ?? ''));
    results.push({
      title: title || url,
      url,
      snippet,
      source: 'duckduckgo',
      rank: results.length + 1,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function normalizeDuckDuckGoUrl(url: string): string {
  try {
    const parsed = new URL(url, 'https://html.duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return parsed.toString();
  } catch {
    return url;
  }
}

function toResult(entry: unknown): { title: string; url: string; snippet: string } | null {
  const item = isRecord(entry) ? entry : undefined;
  const title = firstString(item?.title, item?.name);
  const url = firstString(item?.url, item?.link);
  const snippet = firstString(item?.snippet, item?.description, item?.body, item?.summary);
  if (!title || !url) return null;
  return {
    title: stripTags(title),
    url: String(url),
    snippet: stripTags(snippet ?? ''),
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}
