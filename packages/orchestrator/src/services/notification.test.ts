import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationService,
  isTelegramPollingEnabled,
} from './notification.js';

describe('telegram callback delivery', () => {
  const prevPollingEnv = process.env.UJIMA_TELEGRAM_POLLING;

  afterEach(() => {
    if (prevPollingEnv === undefined) delete process.env.UJIMA_TELEGRAM_POLLING;
    else process.env.UJIMA_TELEGRAM_POLLING = prevPollingEnv;
  });

  function enablePollingForTest(): void {
    process.env.UJIMA_TELEGRAM_POLLING = '1';
  }

  it('isTelegramPollingEnabled respects explicit opt-in/out', () => {
    enablePollingForTest();
    expect(isTelegramPollingEnabled()).toBe(true);
    process.env.UJIMA_TELEGRAM_POLLING = '0';
    expect(isTelegramPollingEnabled()).toBe(false);
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

});
