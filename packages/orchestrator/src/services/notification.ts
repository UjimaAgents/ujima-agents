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

  constructor(private readonly repo: ApiRepository) {}

  setApprovalResolver(resolver: ApprovalResolver | undefined): void {
    this.approvalResolver = resolver;
  }

  /**
   * Start polling Telegram for callback queries (inline button presses).
   * Required when no webhook is set (local-first). Call once after setup.
   */
  startPolling(intervalMs = 2000): void {
    this.pollOnce().catch(() => undefined);
    const timer = setInterval(() => this.pollOnce().catch(() => undefined), intervalMs);
    this.pollTimers.set('_global', timer);
    if (this.logErrors) console.error('[notify] telegram polling started every', intervalMs, 'ms');
  }

  stopPolling(): void {
    for (const timer of this.pollTimers.values()) clearInterval(timer);
    this.pollTimers.clear();
  }

  private async pollOnce(): Promise<void> {
    if (!this.approvalResolver) return;
    // List all notification channels across orgs to find Telegram bots
    // We iterate known orgs — in practice there's usually 1 org.
    // For a multi-org setup, the scheduler background task handles this.
    const allChannels: NotificationChannel[] = [];
    // Walk through all organizations to collect Telegram channels
    for (const org of this.repo.listOrganizations()) {
      for (const ch of this.repo.listNotificationChannels(org.id)) {
        allChannels.push(ch);
      }
    }

    for (const channel of allChannels) {
      if (channel.provider !== 'telegram' || !channel.enabled) continue;
      const config = tryParseJson(channel.configJson);
      const token = config?.botToken;
      if (typeof token !== 'string') continue;

      const offset = this.pollOffsets.get(channel.id) ?? 0;
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=5&allowed_updates=["callback_query"]`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const body = await res.json() as { ok: boolean; result: { update_id: number; callback_query?: { id: string; data: string } }[] };
        if (!body.ok || !body.result) continue;

        for (const update of body.result) {
          const cb = update.callback_query;
          if (!cb?.data) continue;
          const newOffset = update.update_id + 1;
          this.pollOffsets.set(channel.id, newOffset);

          // Resolve the approval
          const err = await resolveApprovalFromTelegram(cb.data, this.approvalResolver, this.logErrors).catch(e => e?.message ?? 'error');

          // Answer callback to clear loading state
          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: cb.id,
              text: err ? `Failed: ${err}` : 'Approved ✓',
              show_alert: !!err,
            }),
          }).catch(() => undefined);
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
          await sendTelegramWithInlineKeyboard(configFromChannel(channel), text, input.approvalId, input.organizationId, this.logErrors, channel.id);
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

/** In-memory store for Telegram inline callback tokens → (approvalId, orgId, channelId). */
const telegramCallbackTokens = new Map<string, { approvalId: string; organizationId: string; channelId?: string }>();

const TOKEN_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomToken(): string {
  let t = '';
  for (let i = 0; i < 6; i++) t += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  return t;
}

/**
 * Parse a Telegram callback query from an inline keyboard button.
 * Looks up the short token in the in-memory store.
 */
export function resolveTelegramCallbackToken(
  token: string,
): { approvalId: string; organizationId: string; channelId?: string } | null {
  const data = telegramCallbackTokens.get(token);
  return data ? { approvalId: data.approvalId, organizationId: data.organizationId, channelId: data.channelId } : null;
}

/**
 * Called by the API webhook route when a Telegram user clicks an inline
 * keyboard button. Parses the callback data and resolves the approval.
 */
export async function resolveApprovalFromTelegram(
  callbackData: string,
  resolve: ApprovalResolver,
  log: boolean,
): Promise<string | null> {
  const sep = callbackData.indexOf(':');
  if (sep < 0) {
    if (log) console.error('[notify] invalid callback data:', callbackData);
    return 'Invalid callback data';
  }
  const rawAction = callbackData.slice(0, sep);
  const token = callbackData.slice(sep + 1);
  if (rawAction !== 'approve' && rawAction !== 'reject') {
    if (log) console.error('[notify] unknown action:', rawAction);
    return 'Unknown action';
  }
  if (!token) {
    if (log) console.error('[notify] missing token');
    return 'Missing token';
  }

  const data = telegramCallbackTokens.get(token);
  if (!data) {
    if (log) console.error('[notify] token not found (expired?):', token);
    return 'Token expired or invalid';
  }
  telegramCallbackTokens.delete(token);

  try {
    await resolve(data.organizationId, data.approvalId, rawAction === 'approve' ? 'approved' : 'rejected');
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
  organizationId: string,
  log: boolean,
  channelId?: string,
): Promise<void> {
  const token = config.botToken;
  const chatId = config.chatId;
  if (typeof token !== 'string' || typeof chatId !== 'string') {
    if (log) console.error('[notify] telegram missing botToken or chatId for approval');
    return;
  }

  const cbToken = randomToken();
  telegramCallbackTokens.set(cbToken, { approvalId, organizationId, channelId });

  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `approve:${cbToken}` },
      { text: '❌ Reject', callback_data: `reject:${cbToken}` },
    ]],
  };

  if (log) console.error('[notify] telegram approval with inline keyboard');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup }),
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
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Telegram ${res.status}: ${body}`);
  }
  if (log) console.error('[notify] telegram response:', body.slice(0, 200));
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
