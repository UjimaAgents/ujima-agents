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

interface NotifyApprovalInput {
  organizationId: string;
  requesterName: string;
  resourceType: string;
  action: string;
  resourcePath: string;
  approvalId: string;
}

export class NotificationService {
  constructor(private readonly repo: ApiRepository) {}

  async notifyMessage(input: NotifyMessageInput): Promise<void> {
    const channels = this.repo.listNotificationChannels(input.organizationId);
    const active = channels.filter((c) => c.enabled && c.notifyMessages);
    if (active.length === 0) return;

    const text = `💬 ${input.senderName} in #${input.channelName}:\n${input.content.slice(0, 500)}`;
    for (const channel of active) {
      await this.send(channel, text).catch(() => {});
    }
  }

  async notifyApproval(input: NotifyApprovalInput): Promise<void> {
    const channels = this.repo.listNotificationChannels(input.organizationId);
    const active = channels.filter((c) => c.enabled && c.notifyApprovals);
    if (active.length === 0) return;

    const text = `🔓 Approval needed: ${input.requesterName} wants to ${input.action} on ${input.resourcePath} (${input.resourceType})`;
    for (const channel of active) {
      await this.send(channel, text).catch(() => {});
    }
  }

  private async send(channel: NotificationChannel, text: string): Promise<void> {
    const config = tryParseJson(channel.configJson);
    if (!config) return;

    switch (channel.provider) {
      case 'telegram':
        await sendTelegram(config, text);
        break;
      case 'whatsapp':
        await sendWhatsApp(config, text);
        break;
      case 'webhook':
        await sendWebhook(config, text);
        break;
    }
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function sendTelegram(config: Record<string, unknown>, text: string): Promise<void> {
  const token = config.botToken;
  const chatId = config.chatId;
  if (typeof token !== 'string' || typeof chatId !== 'string') return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
}

async function sendWhatsApp(config: Record<string, unknown>, text: string): Promise<void> {
  const phone = config.phone;
  const apiKey = config.apiKey;
  if (typeof phone !== 'string' || typeof apiKey !== 'string') return;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatsApp API error ${res.status}: ${body}`);
  }
}

async function sendWebhook(config: Record<string, unknown>, text: string): Promise<void> {
  const url = config.webhookUrl;
  if (typeof url !== 'string') return;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Webhook error ${res.status}: ${body}`);
  }
}
