import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchTool } from './web-tools.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('web tools', () => {
  it('blocks localhost fetches before calling fetch', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;

    await expect(
      fetchTool.execute({
        invocation: {
          organizationId: 'org-1',
          runId: 'run-1',
          memberId: 'agent-1',
          toolCallId: 'tool-1',
          toolId: 'fetch',
          action: 'read',
          resourceType: 'message',
          input: { url: 'http://localhost:7511/bootstrap' },
        } as never,
        team: {} as never,
        repo: {} as never,
        conversations: {} as never,
      }),
    ).rejects.toThrow('URL host is not allowed');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
