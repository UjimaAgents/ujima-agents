import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApprovalRequest } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

interface NotificationChannel {
  id: string;
  organizationId: string;
  provider: 'telegram' | 'whatsapp' | 'webhook';
  configJson: string;
  enabled: boolean;
  notifyMessages: boolean;
  notifyApprovals: boolean;
}

interface NotifyMessageInput {
  organizationId: string;
  channelName: string;
  senderName: string;
  content: string;
  threadId?: string;
}

export interface NotifyApprovalInput {
  organizationId: string;
  requesterName: string;
  resourceType: string;
  action: string;
  resourcePath: string;
  approvalId: string;
}

export class NotificationService {
  /** Set to false to suppress error logging. */
  logErrors = true;
  private approvalResolver?: ApprovalResolver;
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private pollOffsets = new Map<string, number>();
  private pollInFlight = false;

  constructor(private readonly repo: ApiRepository) {}

  setApprovalResolver(resolver: ApprovalResolver | undefined): void {
    this.approvalResolver = resolver;
  }

  /**
   * Start polling Telegram for callback queries (inline button presses).
   * Required when no webhook is set (local-first). Call once after setup.
   */
  startPolling(intervalMs = 2000): void {
    if (this.pollTimers.has('_global')) return;
    void this.runPollingTick();
    const timer = setInterval(() => {
      void this.runPollingTick();
    }, intervalMs);
    this.pollTimers.set('_global', timer);
    if (this.logErrors) console.error('[notify] telegram polling started every', intervalMs, 'ms');
  }

  stopPolling(): void {
    for (const timer of this.pollTimers.values()) clearInterval(timer);
    this.pollTimers.clear();
    this.pollInFlight = false;
  }

  private async runPollingTick(): Promise<void> {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      await this.pollOnce();
    } finally {
      this.pollInFlight = false;
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.approvalResolver) return;
    const telegramBotTokens = new Set<string>();
    for (const org of this.repo.listOrganizations()) {
      for (const ch of this.repo.listNotificationChannels(org.id)) {
        if (ch.provider !== 'telegram' || !ch.enabled) continue;
        const config = tryParseJson(ch.configJson);
        const token = config?.botToken;
        if (typeof token === 'string' && token) {
          telegramBotTokens.add(token);
        }
      }
    }

    for (const token of telegramBotTokens) {
      const offset = this.pollOffsets.get(token) ?? 0;
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=5&allowed_updates=["callback_query"]`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const body = await res.json() as { ok: boolean; result: { update_id: number; callback_query?: { id: string; data: string } }[] };
        if (!body.ok || !body.result) continue;

        for (const update of body.result) {
          const cb = update.callback_query;
          const newOffset = update.update_id + 1;
          if (!cb?.data) {
            this.pollOffsets.set(token, newOffset);
            continue;
          }

          let err: string | null;
          try {
            err = await resolveApprovalFromTelegram(
              cb.data,
              token,
              (approvalId) => findApprovalById(this.repo, approvalId),
              this.approvalResolver,
              this.logErrors,
            );
          } catch (e) {
            if (this.logErrors) console.error('[notify] resolve callback failed:', e);
            continue;
          }

          let ackOk = false;
          try {
            const ackRes = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                callback_query_id: cb.id,
                text: err ? `Failed: ${err}` : 'Approved ✓',
                show_alert: !!err,
              }),
            });
            ackOk = ackRes.ok;
          } catch (e) {
            if (this.logErrors) console.error('[notify] answer callback failed:', e);
          }

          if (ackOk) {
            this.pollOffsets.set(token, newOffset);
          }
        }
      } catch (e) {
        if (this.logErrors) console.error('[notify] poll error:', e);
      }
    }
  }

  async notifyMessage(input: NotifyMessageInput): Promise<void> {
    const channels = this.repo.listNotificationChannels(input.organizationId);
    const active = channels.filter((c) => c.enabled && c.notifyMessages);
    if (active.length === 0) {
      if (this.logErrors) console.error('[notify] no active message channels for', input.organizationId);
      return;
    }
    if (this.logErrors) console.error(`[notify] found ${active.length} channel(s) for message`);

    const text = `💬 ${input.senderName} in #${input.channelName}:\n${input.content.slice(0, 500)}`;
    for (const channel of active) {
      try {
        await this.send(channel, text);
      } catch (err) {
        if (this.logErrors) console.error(`[notify] ${channel.provider} send failed:`, err);
      }
    }
  }

  async notifyApproval(input: NotifyApprovalInput): Promise<void> {
    const channels = this.repo.listNotificationChannels(input.organizationId);
    const active = channels.filter((c) => c.enabled && c.notifyApprovals);
    if (active.length === 0) {
      if (this.logErrors) console.error('[notify] no active approval channels for', input.organizationId);
      return;
    }
    if (this.logErrors) console.error(`[notify] found ${active.length} channel(s) for approval`);

    const text = `🔓 Approval needed: ${input.requesterName} wants to ${input.action} on ${input.resourcePath} (${input.resourceType})`;
    for (const channel of active) {
      try {
        if (channel.provider === 'telegram') {
          await sendTelegramWithInlineKeyboard(
            configFromChannel(channel),
            text,
            input.approvalId,
            this.logErrors,
          );
        } else {
          await this.send(channel, text);
        }
      } catch (err) {
        if (this.logErrors) console.error(`[notify] ${channel.provider} send failed:`, err);
      }
    }
  }

  private async send(channel: NotificationChannel, text: string): Promise<void> {
    const config = tryParseJson(channel.configJson);
    if (!config) {
      if (this.logErrors) console.error('[notify] invalid config JSON for channel', channel.id);
      return;
    }

    switch (channel.provider) {
      case 'telegram':
        await sendTelegram(config, text, this.logErrors);
        break;
      case 'whatsapp':
        await sendWhatsApp(config, text, this.logErrors);
        break;
      case 'webhook':
        await sendWebhook(config, text, this.logErrors);
        break;
    }
  }
}

function configFromChannel(channel: NotificationChannel): Record<string, unknown> {
  return tryParseJson(channel.configJson) ?? {};
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type ApprovalResolver = (
  organizationId: string,
  approvalId: string,
  status: 'approved' | 'rejected',
) => Promise<void>;

const TELEGRAM_CALLBACK_SIGNATURE_LENGTH = 12;
type TelegramCallbackAction = 'a' | 'r';

/**
 * Called by the API webhook route when a Telegram user clicks an inline
 * keyboard button. Parses the callback data and resolves the approval.
 */
export async function resolveApprovalFromTelegram(
  callbackData: string,
  botToken: string,
  lookupApproval: (approvalId: string) => ApprovalRequest | null,
  resolve: ApprovalResolver,
  log: boolean,
): Promise<string | null> {
  const parsed = parseTelegramApprovalCallback(callbackData);
  if (!parsed) {
    if (log) console.error('[notify] invalid callback data:', callbackData);
    return 'Invalid callback data';
  }

  const expectedSignature = signTelegramApprovalCallback(
    parsed.action,
    parsed.approvalId,
    botToken,
  );
  if (!safeEqualTelegramSignature(parsed.signature, expectedSignature)) {
    if (log) console.error('[notify] invalid callback signature for approval:', parsed.approvalId);
    return 'Invalid callback data';
  }

  const approval = lookupApproval(parsed.approvalId);
  if (!approval || approval.status !== 'pending') {
    if (log) console.error('[notify] approval not found or already resolved:', parsed.approvalId);
    return 'Approval not found or already resolved';
  }

  try {
    await resolve(approval.organizationId, approval.id, parsed.status);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (log) console.error('[notify] approval resolve failed:', msg);
    return msg;
  }
}

async function sendTelegramWithInlineKeyboard(
  config: Record<string, unknown>,
  text: string,
  approvalId: string,
  log: boolean,
): Promise<void> {
  const token = config.botToken;
  const chatId = config.chatId;
  if (typeof token !== 'string' || typeof chatId !== 'string') {
    if (log) console.error('[notify] telegram missing botToken or chatId for approval');
    return;
  }

  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: buildTelegramApprovalCallback('a', approvalId, token) },
      { text: '❌ Reject', callback_data: buildTelegramApprovalCallback('r', approvalId, token) },
    ]],
  };

  if (log) console.error('[notify] telegram approval with inline keyboard');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${body}`);
  if (log) console.error('[notify] telegram approval sent:', body.slice(0, 200));
}

async function sendTelegram(config: Record<string, unknown>, text: string, log: boolean): Promise<void> {
  const token = config.botToken;
  const chatId = config.chatId;
  if (typeof token !== 'string' || typeof chatId !== 'string') {
    if (log) console.error('[notify] telegram missing botToken or chatId');
    return;
  }

  const url = `https://api.telegram.org/bot${token.slice(0, 8)}.../sendMessage`;
  if (log) console.error('[notify] telegram POST to', url);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Telegram ${res.status}: ${body}`);
  }
  if (log) console.error('[notify] telegram response:', body.slice(0, 200));
}

function buildTelegramApprovalCallback(
  action: TelegramCallbackAction,
  approvalId: string,
  botToken: string,
): string {
  const signature = signTelegramApprovalCallback(action, approvalId, botToken);
  return `${action}:${approvalId}:${signature}`;
}

function signTelegramApprovalCallback(
  action: TelegramCallbackAction,
  approvalId: string,
  botToken: string,
): string {
  return createHmac('sha256', botToken)
    .update(`telegram-approval:${action}:${approvalId}`)
    .digest('base64url')
    .slice(0, TELEGRAM_CALLBACK_SIGNATURE_LENGTH);
}

function parseTelegramApprovalCallback(
  callbackData: string,
): { action: TelegramCallbackAction; approvalId: string; signature: string; status: 'approved' | 'rejected' } | null {
  const parts = callbackData.split(':');
  if (parts.length !== 3) return null;
  const [action, approvalId, signature] = parts;
  if ((action !== 'a' && action !== 'r') || !approvalId || !signature) return null;
  return {
    action,
    approvalId,
    signature,
    status: action === 'a' ? 'approved' : 'rejected',
  };
}

function safeEqualTelegramSignature(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function findApprovalById(repo: ApiRepository, approvalId: string): ApprovalRequest | null {
  for (const org of repo.listOrganizations()) {
    const approval = repo.getApproval(org.id, approvalId);
    if (approval) return approval;
  }
  return null;
}

async function sendWhatsApp(config: Record<string, unknown>, text: string, log: boolean): Promise<void> {
  const phone = config.phone;
  const apiKey = config.apiKey;
  if (typeof phone !== 'string' || typeof apiKey !== 'string') {
    if (log) console.error('[notify] whatsapp missing phone or apiKey');
    return;
  }
  const encodedPhone = encodeURIComponent(phone);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodedPhone}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;
  if (log) console.error('[notify] whatsapp GET to', `https://api.callmebot.com/whatsapp.php?phone=${encodedPhone}&text=${encodeURIComponent(text.slice(0, 30))}...&apikey=${apiKey.slice(0, 4)}...`);
  const res = await fetch(url);
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`WhatsApp ${res.status}: ${body}`);
  }
  if (log) console.error('[notify] whatsapp response:', body.slice(0, 200));
}

async function sendWebhook(config: Record<string, unknown>, text: string, log: boolean): Promise<void> {
  const url = config.webhookUrl;
  if (typeof url !== 'string') {
    if (log) console.error('[notify] webhook missing url');
    return;
  }

  if (log) console.error('[notify] webhook POST to', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Webhook ${res.status}: ${body}`);
  }
  if (log) console.error('[notify] webhook response:', body.slice(0, 200));
}
