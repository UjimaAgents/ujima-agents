import { describe, expect, it } from 'vitest';
import { captureBrowserState } from './browser';

describe('captureBrowserState', () => {
  it('returns the previous snapshot for non-browser tools', () => {
    const prev = { url: 'https://google.com', observedAt: new Date().toISOString() };
    expect(captureBrowserState('notion_search', {}, [], prev, 'notion')).toBe(prev);
    expect(captureBrowserState('fs_read', { path: '/x' }, 'ok', undefined, 'fs')).toBeUndefined();
  });

  it('pulls URL from browser_navigate args', () => {
    const snap = captureBrowserState(
      'browser_navigate',
      { url: 'https://www.google.com/' },
      [],
      undefined,
      'playwright',
    );
    expect(snap?.url).toBe('https://www.google.com/');
    expect(snap?.mcpId).toBe('playwright');
    expect(snap?.observedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('pulls URL and title from snapshot text output', () => {
    const content = [
      {
        type: 'text',
        text: '### Current page\n- URL: https://example.org/foo\n- Title: Example Foo',
      },
    ];
    const snap = captureBrowserState('browser_snapshot', {}, content, undefined, 'playwright');
    expect(snap?.url).toBe('https://example.org/foo');
    expect(snap?.title).toBe('Example Foo');
  });

  it('records a screenshot reference when the tool returns an image part', () => {
    const content = [
      { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo' },
      { type: 'text', text: 'saved' },
    ];
    const snap = captureBrowserState(
      'browser_screenshot',
      {},
      content,
      undefined,
      'playwright',
    );
    expect(snap?.screenshotRef).toMatch(/^screenshot-ref:image\/png:/);
  });

  it('pulls URL and title from plain string content', () => {
    const content = 'Current page is https://example.org/bar - Example Bar';
    const snap = captureBrowserState('browser_navigate', {}, content, undefined, 'playwright');
    expect(snap?.url).toBe('https://example.org/bar');
  });

  it('merges with a previous snapshot without wiping earlier fields', () => {
    const first = captureBrowserState(
      'browser_navigate',
      { url: 'https://a.test/' },
      [],
      undefined,
      'playwright',
    );
    const second = captureBrowserState(
      'browser_snapshot',
      {},
      [{ type: 'text', text: '- Title: Page A' }],
      first,
      'playwright',
    );
    expect(second?.url).toBe('https://a.test/');
    expect(second?.title).toBe('Page A');
  });

  it('strips trailing punctuation from bare URLs in text', () => {
    const content = [{ type: 'text', text: 'Now at https://example.test/path).' }];
    const snap = captureBrowserState('browser_wait', {}, content, undefined, 'playwright');
    expect(snap?.url).toBe('https://example.test/path');
  });
});
