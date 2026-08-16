import { describe, expect, it } from 'vitest';
import { chooseMcpAttachmentRoute } from './mcp-attachment-dispatch.js';

describe('chooseMcpAttachmentRoute', () => {
  it('uses dispatch only when the feature and pool are both available', () => {
    expect(chooseMcpAttachmentRoute({ dispatchEnabled: true, poolAvailable: true })).toBe('dispatch');
    expect(chooseMcpAttachmentRoute({ dispatchEnabled: true, poolAvailable: false })).toBe('legacy');
    expect(chooseMcpAttachmentRoute({ dispatchEnabled: false, poolAvailable: true })).toBe('legacy');
  });
});
