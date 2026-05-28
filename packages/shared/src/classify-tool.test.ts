import { describe, expect, it } from 'vitest';
import { classifyTool, tokenise, READ_VERBS, WRITE_VERBS, DESTRUCTIVE_VERBS } from './classify-tool.js';

describe('tokenise', () => {
  it('splits on _ and lowercases', () => {
    expect(tokenise('browser_take_screenshot')).toEqual(['browser', 'take', 'screenshot']);
  });

  it('splits camelCase', () => {
    expect(tokenise('getUserProfile')).toEqual(['get', 'user', 'profile']);
  });

  it('handles dashes and slashes', () => {
    expect(tokenise('read-file/contents')).toEqual(['read', 'file', 'contents']);
  });

  it('drops empties', () => {
    expect(tokenise('__weird__name__')).toEqual(['weird', 'name']);
  });
});

describe('verb sets', () => {
  it('READ_VERBS contains the canonical read tokens', () => {
    for (const v of ['get', 'list', 'read', 'search', 'find', 'query']) {
      expect(READ_VERBS.has(v)).toBe(true);
    }
  });

  it('WRITE_VERBS contains the canonical write tokens', () => {
    for (const v of ['create', 'update', 'patch', 'write', 'click']) {
      expect(WRITE_VERBS.has(v)).toBe(true);
    }
  });

  it('DESTRUCTIVE_VERBS contains the canonical destructive tokens', () => {
    for (const v of ['delete', 'drop', 'execute', 'send', 'push', 'merge']) {
      expect(DESTRUCTIVE_VERBS.has(v)).toBe(true);
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

  it('classifies read verbs', () => {
    expect(classifyTool({ name: 'get_user' }).risk).toBe('read');
    expect(classifyTool({ name: 'list_files' }).risk).toBe('read');
    expect(classifyTool({ name: 'search_messages' }).risk).toBe('read');
  });

  it('classifies write verbs', () => {
    expect(classifyTool({ name: 'create_record' }).risk).toBe('write');
    expect(classifyTool({ name: 'update_issue' }).risk).toBe('write');
    expect(classifyTool({ name: 'click_button' }).risk).toBe('write');
  });

  it('falls back to write + needsReview on unknown verbs', () => {
    // `frobnicate_widget` has no verb hit and no description, so it
    // falls through to the low-confidence default.
    const out = classifyTool({ name: 'frobnicate_widget' });
    expect(out.risk).toBe('write');
    expect(out.needsReview).toBe(true);
    expect(out.confidence).toBe('low');
  });

  it('known write verb returns high confidence without needsReview', () => {
    // `handle_dialog` IS a write — accepting/dismissing a dialog.
    // Classifier returns high confidence so admins are not asked to
    // sweep an unambiguous interaction.
    const out = classifyTool({ name: 'browser_handle_dialog' });
    expect(out.risk).toBe('write');
    expect(out.needsReview).toBe(false);
    expect(out.confidence).toBe('high');
  });
});

describe('classifyTool: category disambiguation', () => {
  it('drop in browser context is write (drag-and-drop)', () => {
    const out = classifyTool({ name: 'browser_drop', category: 'browser' });
    expect(out.risk).toBe('write');
    expect(out.confidence).toBe('medium');
  });

  it('drop in database context is destructive', () => {
    const out = classifyTool({ name: 'drop_table', category: 'database' });
    expect(out.risk).toBe('destructive');
  });

  it('post in messaging context is destructive', () => {
    const out = classifyTool({ name: 'post_message', category: 'messaging' });
    expect(out.risk).toBe('destructive');
  });

  it('post in browser context is write', () => {
    const out = classifyTool({ name: 'browser_post_form', category: 'browser' });
    expect(out.risk).toBe('write');
  });

  it('push in vcs context is destructive', () => {
    const out = classifyTool({ name: 'git_push', category: 'vcs' });
    expect(out.risk).toBe('destructive');
  });
});

describe('classifyTool: combo qualifiers', () => {
  it('run without code-like qualifier is write', () => {
    const out = classifyTool({ name: 'run_test' });
    // `run` without combo → skipped → no other verb → fallback write
    expect(out.risk).toBe('write');
  });

  it('run + code is destructive', () => {
    const out = classifyTool({ name: 'run_code_unsafe' });
    expect(out.risk).toBe('destructive');
  });

  it('run + shell is destructive', () => {
    const out = classifyTool({ name: 'shell_run' });
    expect(out.risk).toBe('destructive');
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

  it('description matching "arbitrary code" promotes to destructive', () => {
    const out = classifyTool({
      name: 'browser_evaluate',
      description: 'Evaluate JavaScript expression on page or element',
    });
    expect(out.risk).toBe('destructive');
  });

  it('description matching "returns/lists" rescues unknown tools to read', () => {
    const out = classifyTool({
      name: 'accessibility_tree',
      description: 'Returns the accessibility tree of the current page.',
    });
    expect(out.risk).toBe('read');
    expect(out.confidence).toBe('medium');
    expect(out.needsReview).toBe(true);
  });
});

describe('classifyTool: Playwright MCP examples', () => {
  // Matches the worked-example table in plan §4.5.
  it.each([
    ['browser_navigate', 'Navigate to a URL', 'browser', 'write'],
    ['browser_snapshot', 'Capture accessibility snapshot of the current page', 'browser', 'read'],
    ['browser_click', 'Perform click on a web page', 'browser', 'write'],
    ['browser_type', 'Type text into editable element', 'browser', 'write'],
    ['browser_evaluate', 'Evaluate JavaScript expression on page or element', 'browser', 'destructive'],
    [
      'browser_run_code_unsafe',
      'Unsafe: executes arbitrary JavaScript in the Playwright server process and is RCE-equivalent.',
      'browser',
      'destructive',
    ],
    ['browser_close', 'Close the page', 'browser', 'write'],
    ['browser_file_upload', 'Upload one or multiple files', 'browser', 'write'],
    [
      'browser_drop',
      'Drop files or MIME-typed data onto an element, as if dragged from outside the page.',
      'browser',
      'write',
    ],
  ])('classifies %s as %s', (name, description, category, expected) => {
    const out = classifyTool({ name, description, category });
    expect(out.risk).toBe(expected);
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
