import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, ApprovalResolver } from '@ujima/orchestrator';
import { resolveApprovalFromTelegram, resolveTelegramCallbackToken } from '@ujima/orchestrator';
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
  resolveApproval?: ApprovalResolver;
}

export function registerNotificationRoutes(api: FastifyInstance, deps: NotificationRouteDeps): void {
  api.get('/notifications/channels', {
    schema: { description: 'List notification channels', tags: ['Notifications'] },
  }, async (req, reply) => {
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated) return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    const channels = deps.repo.listNotificationChannels(authState.user.organizationId);
    return reply.status(200).send({ channels });
  });

  api.post('/notifications/channels', {
    schema: { description: 'Create a notification channel', tags: ['Notifications'] },
  }, async (req, reply) => {
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated) return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
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
    if (!authState.authenticated) return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
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
    if (!authState.authenticated) return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    const { id } = req.params as { id: string };
    deps.repo.deleteNotificationChannel(authState.user.organizationId, id);
    return reply.status(204).send();
  });

  // Telegram bot webhook — called by Telegram servers when a user
  // clicks an inline keyboard button on an approval notification.
  // Expects POST with the standard Telegram Update JSON payload.
  api.post('/notifications/telegram-webhook', {
    schema: { description: 'Telegram bot webhook for inline keyboard callbacks', tags: ['Notifications'] },
  }, async (req, reply) => {
    const update = req.body as Record<string, unknown>;
    const callbackQuery = update?.callback_query as Record<string, unknown> | undefined;
    if (!callbackQuery?.data || !callbackQuery?.id) {
      return reply.status(200).send({ ok: false, reason: 'not a callback query' });
    }

    if (!deps.resolveApproval) {
      return reply.status(200).send({ ok: false, reason: 'no resolver configured' });
    }

    // Validate the token and get the stored data
    const parts = (callbackQuery.data as string).split(':');
    const token = parts[1];
    const tokenData = token ? resolveTelegramCallbackToken(token) : null;
    if (!tokenData) {
      return reply.status(200).send({ ok: false, reason: 'invalid or expired token' });
    }

    // Validate the approval still exists before resolving
    const approval = deps.repo.getApproval(tokenData.organizationId, tokenData.approvalId);
    if (!approval || approval.status !== 'pending') {
      return reply.status(200).send({ ok: false, reason: 'approval not found or already resolved' });
    }

    // Resolve the approval
    const err = await resolveApprovalFromTelegram(
      callbackQuery.data as string,
      deps.resolveApproval,
      true,
    );

    // Look up bot token from the notification channel for answering callback
    let botToken = '';
    if (tokenData.channelId) {
      const ch = deps.repo.getNotificationChannel(tokenData.organizationId, tokenData.channelId);
      if (ch) {
        try {
          botToken = (JSON.parse(ch.configJson) as Record<string, string>).botToken ?? '';
        } catch { /* ignore */ }
      }
    }

    // Answer callback to clear the loading state on the button
    if (botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: err ? `Failed: ${err}` : 'Approved ✓',
          show_alert: !!err,
        }),
      }).catch(() => {});
    }

    return reply.status(200).send({ ok: !err });
  });
}
