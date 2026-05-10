import { afterEach, describe, expect, it, vi } from 'vitest';
import { webSearchTool } from './web-search.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WEB_SEARCH_PRIMARY_URL;
  delete process.env.WEB_SEARCH_PRIMARY_API_KEY;
});

describe('web_search tool', () => {
  it('falls back to DuckDuckGo HTML and streams intermediate results', async () => {
    const html = `
      <div class="result">
        <div>
          <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Alpha</a>
          <a class="result__snippet">First result</a>
        </div>
      </div>
      <div class="result">
        <div>
          <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Beta</a>
          <a class="result__snippet">Second result</a>
        </div>
      </div>
    `;

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      expect(url).toContain('html.duckduckgo.com/html/');
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const reportProgress = vi.fn();
    const result = await webSearchTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'tool-1',
        toolId: 'web_search',
        action: 'read',
        resourceType: 'message',
        input: { query: 'ujima agents' },
      } as never,
      team: {} as never,
      repo: {} as never,
      conversations: {} as never,
      reportProgress,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportProgress).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'completed',
      source: 'duckduckgo',
      results: [
        {
          rank: 1,
          title: 'Alpha',
          url: 'https://example.com/a',
          snippet: 'First result',
          source: 'duckduckgo',
        },
        {
          rank: 2,
          title: 'Beta',
          url: 'https://example.com/b',
          snippet: 'Second result',
          source: 'duckduckgo',
        },
      ],
    });
  });
});
