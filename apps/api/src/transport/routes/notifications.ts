import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, ApprovalResolver } from '@ujima/orchestrator';
import { resolveApprovalFromTelegram } from '@ujima/orchestrator';
import { z } from 'zod';

const CreateChannelSchema = z.object({
  provider: z.enum(['telegram', 'whatsapp', 'webhook']),
  config: z.object({
    webhookUrl: z.string().optional(),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    phone: z.string().optional(),
    apiKey: z.string().optional(),
  }),
  notifyMessages: z.boolean().default(true),
  notifyApprovals: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

const UpdateChannelSchema = z.object({
  config: z.object({
    webhookUrl: z.string().optional(),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    phone: z.string().optional(),
    apiKey: z.string().optional(),
  }).optional(),
  notifyMessages: z.boolean().optional(),
  notifyApprovals: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

interface NotificationRouteDeps {
  repo: Repository;
  auth: AuthService;
}

export interface TelegramWebhookDeps {
  repo: Repository;
  resolveApproval: ApprovalResolver;
}

export function registerTelegramWebhookRoute(api: FastifyInstance, deps: TelegramWebhookDeps): void {
  // Called by Telegram servers (no session/bearer). Callback payloads are
  // authenticated via HMAC signatures in resolveApprovalFromTelegram.
  api.post('/notifications/telegram-webhook', {
    schema: { description: 'Telegram bot webhook for inline keyboard callbacks', tags: ['Notifications'] },
  }, async (req, reply) => {
    const update = req.body as Record<string, unknown>;
    const callbackQuery = update?.callback_query as Record<string, unknown> | undefined;
    if (!callbackQuery?.data || !callbackQuery?.id) {
      return reply.status(200).send({ ok: false, reason: 'not a callback query' });
    }

    const callbackData = callbackQuery.data as string;
    const lookupApproval = (approvalId: string) => {
      for (const org of deps.repo.listOrganizations()) {
        const approval = deps.repo.getApproval(org.id, approvalId);
        if (approval) return approval;
      }
      return null;
    };

    let botToken = '';
    let err: string | null = 'telegram bot token not configured';
    for (const org of deps.repo.listOrganizations()) {
      for (const channel of deps.repo.listNotificationChannels(org.id)) {
        if (channel.provider !== 'telegram' || !channel.enabled) continue;
        let candidateToken = '';
        try {
          candidateToken = (JSON.parse(channel.configJson) as Record<string, string>).botToken ?? '';
        } catch {
          candidateToken = '';
        }
        if (!candidateToken) continue;

        const candidateErr = await resolveApprovalFromTelegram(
          callbackData,
          candidateToken,
          lookupApproval,
          deps.resolveApproval,
          true,
        );
        if (candidateErr !== 'Invalid callback data') {
          botToken = candidateToken;
          err = candidateErr;
          break;
        }
      }
      if (botToken) break;
    }

    if (botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: err ? `Failed: ${err}` : 'Approved ✓',
          show_alert: !!err,
        }),
      }).catch(() => undefined);
    }

    return reply.status(200).send({ ok: !err });
  });
}

export function registerNotificationRoutes(api: FastifyInstance, deps: NotificationRouteDeps): void {
  api.get('/notifications/channels', {
    schema: { description: 'List notification channels', tags: ['Notifications'] },
  }, async (req, reply) => {
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated || !authState.user) return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    const channels = deps.repo.listNotificationChannels(authState.user.organizationId);
    return reply.status(200).send({ channels });
  });

  api.post('/notifications/channels', {
    schema: { description: 'Create a notification channel', tags: ['Notifications'] },
  }, async (req, reply) => {
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated || !authState.user) return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    const body = CreateChannelSchema.parse(req.body);
    const now = new Date().toISOString();
    deps.repo.saveNotificationChannel({
      id: randomUUID(),
      organizationId: authState.user.organizationId,
      provider: body.provider,
      configJson: JSON.stringify(body.config),
      enabled: body.enabled,
      notifyMessages: body.notifyMessages,
      notifyApprovals: body.notifyApprovals,
      createdAt: now,
      updatedAt: now,
    });
    return reply.status(201).send({ ok: true });
  });

  api.patch('/notifications/channels/:id', {
    schema: { description: 'Update a notification channel', tags: ['Notifications'] },
  }, async (req, reply) => {
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated || !authState.user) return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const existing = deps.repo.getNotificationChannel(authState.user.organizationId, id);
    if (!existing) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Channel not found' });
    const body = UpdateChannelSchema.parse(req.body);
    deps.repo.saveNotificationChannel({
      ...existing,
      configJson: body.config ? JSON.stringify(body.config) : existing.configJson,
      enabled: body.enabled ?? existing.enabled,
      notifyMessages: body.notifyMessages ?? existing.notifyMessages,
      notifyApprovals: body.notifyApprovals ?? existing.notifyApprovals,
      updatedAt: new Date().toISOString(),
    });
    return reply.status(200).send({ ok: true });
  });

  api.delete('/notifications/channels/:id', {
    schema: { description: 'Delete a notification channel', tags: ['Notifications'] },
  }, async (req, reply) => {
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated || !authState.user) return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    const { id } = req.params as { id: string };
    deps.repo.deleteNotificationChannel(authState.user.organizationId, id);
    return reply.status(204).send();
  });
}
