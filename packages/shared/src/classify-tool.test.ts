import { describe, expect, it } from 'vitest';
import { classifyTool, tokenise, READ_VERBS } from './classify-tool.js';

describe('tokenise', () => {
  it('splits on _ and lowercases', () => {
    expect(tokenise('browser_take_screenshot')).toEqual(['browser', 'take', 'screenshot']);
  });

});

describe('verb sets', () => {
  it('READ_VERBS contains the canonical read tokens', () => {
    for (const v of ['get', 'list', 'read', 'search', 'find', 'query']) {
      expect(READ_VERBS.has(v)).toBe(true);
    }
  });

});

describe('classifyTool: registry / declared hints', () => {
  it('registry hint forces destructive', () => {
    const out = classifyTool({
      name: 'browser_close',
      knownDestructiveTools: ['browser_close'],
    });
    expect(out.risk).toBe('destructive');
    expect(out.confidence).toBe('high');
  });

  it('declaredDestructive flag forces destructive', () => {
    const out = classifyTool({ name: 'get_thing', declaredDestructive: true });
    expect(out.risk).toBe('destructive');
  });
});

describe('classifyTool: name-based inference', () => {
  it('classifies destructive verbs', () => {
    expect(classifyTool({ name: 'delete_thing' }).risk).toBe('destructive');
    expect(classifyTool({ name: 'drop_table' }).risk).toBe('destructive');
    expect(classifyTool({ name: 'execute_query' }).risk).toBe('destructive');
  });

});

describe('classifyTool: category disambiguation', () => {
  it('drop in browser context is write (drag-and-drop)', () => {
    const out = classifyTool({ name: 'browser_drop', category: 'browser' });
    expect(out.risk).toBe('write');
    expect(out.confidence).toBe('medium');
  });

});

describe('classifyTool: combo qualifiers', () => {
  it('run without code-like qualifier is write', () => {
    const out = classifyTool({ name: 'run_test' });
    // `run` without combo → skipped → no other verb → fallback write
    expect(out.risk).toBe('write');
  });

});

describe('classifyTool: description promotion', () => {
  it('description matching "permanently deletes" promotes to destructive', () => {
    const out = classifyTool({
      name: 'update_record',
      description: 'Updates a record; this permanently deletes any prior version.',
    });
    expect(out.risk).toBe('destructive');
  });

});

describe('classifyTool: hedging flags needsReview', () => {
  it('hedging language flags needsReview', () => {
    const out = classifyTool({
      name: 'click_button',
      description: 'Experimental: may not work in all browsers.',
    });
    expect(out.risk).toBe('write');
    expect(out.needsReview).toBe(true);
  });
});
