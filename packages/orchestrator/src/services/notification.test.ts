import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationService,
  isTelegramPollingEnabled,
  usesTelegramCallbackWebhook,
} from './notification.js';

describe('telegram callback delivery', () => {
  const prevPollingEnv = process.env.UJIMA_TELEGRAM_POLLING;

  afterEach(() => {
    if (prevPollingEnv === undefined) delete process.env.UJIMA_TELEGRAM_POLLING;
    else process.env.UJIMA_TELEGRAM_POLLING = prevPollingEnv;
  });

  it('usesTelegramCallbackWebhook detects webhook mode', () => {
    expect(usesTelegramCallbackWebhook({ callbackDelivery: 'webhook' })).toBe(true);
    expect(usesTelegramCallbackWebhook({ callbackDelivery: 'polling' })).toBe(false);
    expect(usesTelegramCallbackWebhook({})).toBe(false);
  });

  it('isTelegramPollingEnabled respects UJIMA_TELEGRAM_POLLING=0', () => {
    process.env.UJIMA_TELEGRAM_POLLING = '0';
    expect(isTelegramPollingEnabled()).toBe(false);
    delete process.env.UJIMA_TELEGRAM_POLLING;
    expect(isTelegramPollingEnabled()).toBe(true);
  });

  it('startPolling does not install an interval when polling is disabled', () => {
    process.env.UJIMA_TELEGRAM_POLLING = '0';
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const svc = new NotificationService({
      listOrganizations: () => [{ id: 'org-1' }],
      listNotificationChannels: () => [{
        id: 'ch-1',
        organizationId: 'org-1',
        provider: 'telegram',
        configJson: JSON.stringify({ botToken: 'token', chatId: '1' }),
        enabled: true,
        notifyMessages: true,
        notifyApprovals: true,
      }],
    } as never);
    svc.logErrors = false;
    svc.setApprovalResolver(async () => undefined);
    svc.startPolling();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    svc.stopPolling();
    setIntervalSpy.mockRestore();
  });

  it('startPolling keeps the loop running before telegram channels exist', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const svc = new NotificationService({
      listOrganizations: () => [],
      listNotificationChannels: () => [],
    } as never);
    svc.logErrors = false;
    svc.setApprovalResolver(async () => undefined);
    svc.startPolling();
    expect(setIntervalSpy).toHaveBeenCalledOnce();
    svc.stopPolling();
    setIntervalSpy.mockRestore();
  });

  it('stopPolling aborts an in-flight long poll', async () => {
    const repo = {
      listOrganizations: () => [{ id: 'org-1' }],
      listNotificationChannels: () => [{
        id: 'ch-1',
        organizationId: 'org-1',
        provider: 'telegram',
        configJson: JSON.stringify({ botToken: 'token', chatId: '1' }),
        enabled: true,
        notifyMessages: true,
        notifyApprovals: true,
      }],
    };
    const originalFetch = global.fetch;
    let pollSignal: AbortSignal | undefined;
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      pollSignal = init?.signal ?? undefined;
      pollSignal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      });
    })) as typeof fetch;

    try {
      const svc = new NotificationService(repo as never);
      svc.logErrors = false;
      svc.setApprovalResolver(async () => undefined);
      svc.startPolling();
      await vi.waitFor(() => {
        expect(pollSignal).toBeDefined();
      });
      svc.stopPolling();
      expect(pollSignal?.aborted).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
