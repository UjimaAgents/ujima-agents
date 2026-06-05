import { afterEach, describe, expect, it } from 'vitest';
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
    svc.stopPolling();
  });
});
