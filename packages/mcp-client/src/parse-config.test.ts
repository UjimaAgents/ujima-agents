import { describe, expect, it } from 'vitest';
import { parseMCPConfigJSON, parseMCPConfigObject } from './parse-config';

describe('MCP config parser', () => {
  it('parses the Claude Desktop mcpServers format', () => {
    const input = JSON.stringify({
      mcpServers: {
        'Figma AI Bridge': {
          command: 'npx',
          args: ['-y', 'figma-developer-mcp', '--stdio'],
          env: { FIGMA_TOKEN: 'abc' },
        },
      },
    });
    const { defs, warnings } = parseMCPConfigJSON(input);
    expect(warnings).toEqual([]);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      id: 'Figma AI Bridge',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'figma-developer-mcp', '--stdio'],
      env: { FIGMA_TOKEN: 'abc' },
    });
  });

  it('accepts a bare servers-map object', () => {
    const { defs } = parseMCPConfigObject({
      fs: { command: 'node', args: ['server.js'] },
      api: { url: 'https://example.com/mcp' },
    });
    expect(defs.map((d) => d.id).sort()).toEqual(['api', 'fs']);
    const api = defs.find((d) => d.id === 'api');
    expect(api?.transport).toBe('http-streamable');
    expect(api?.url).toBe('https://example.com/mcp');
  });

  it('infers sse transport from /sse url suffix', () => {
    const { defs } = parseMCPConfigObject({
      legacy: { url: 'https://example.com/mcp/sse' },
    });
    expect(defs[0]?.transport).toBe('sse');
  });

  it('collects warnings for malformed entries and continues', () => {
    const { defs, warnings } = parseMCPConfigObject({
      mcpServers: {
        good: { command: 'node' },
        bad: 'oops',
      },
    });
    expect(defs.map((d) => d.id)).toEqual(['good']);
    expect(warnings.some((w) => w.includes('bad'))).toBe(true);
  });

  it('throws on non-JSON input', () => {
    expect(() => parseMCPConfigJSON('{not json')).toThrow(/Invalid JSON/);
  });
});
