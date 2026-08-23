import { describe, expect, it } from 'vitest';
import { OnboardingAttemptLifecycle } from '../src/transport/onboarding-attempt-cache.js';

describe('OnboardingAttemptLifecycle', () => {
  it('deduplicates in-flight work and expires completed attempts', () => {
    let now = 0;
    const lifecycle = new OnboardingAttemptLifecycle<string>({ ttlMs: 10, now: () => now });

    expect(lifecycle.begin()).toBe(true);
    expect(lifecycle.begin()).toBe(false);
    lifecycle.complete('attempt-1', 'request-1', 'created');
    lifecycle.release();

    expect(lifecycle.getCompleted('attempt-1', 'request-1')).toBe('created');
    expect(lifecycle.getCompleted('attempt-1', 'request-2')).toBeUndefined();
    now = 10;
    expect(lifecycle.getCompleted('attempt-1', 'request-1')).toBeUndefined();
    expect(lifecycle.begin()).toBe(true);
  });

  it('keeps only the newest bounded attempt responses', () => {
    const lifecycle = new OnboardingAttemptLifecycle<string>({ maxEntries: 2 });
    lifecycle.complete('one', 'one-request', '1');
    lifecycle.complete('two', 'two-request', '2');
    lifecycle.complete('three', 'three-request', '3');

    expect(lifecycle.getCompleted('one', 'one-request')).toBeUndefined();
    expect(lifecycle.getCompleted('two', 'two-request')).toBe('2');
    expect(lifecycle.getCompleted('three', 'three-request')).toBe('3');
  });
});
