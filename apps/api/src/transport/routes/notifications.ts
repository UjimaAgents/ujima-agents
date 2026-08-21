import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { NotificationChannelRow, Repository } from '@ujima/runtime-core';
import type { AuthService, ApprovalResolver } from '@ujima/orchestrator';
import { resolveApprovalFromTelegram } from '@ujima/orchestrator';
import { z } from 'zod';
import { httpError } from './route-errors.js';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

const CreateChannelSchema = z.object({
  provider: z.enum(['telegram', 'whatsapp', 'webhook']),
  config: z.object({
    webhookUrl: z.string().optional(),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    phone: z.string().optional(),
    apiKey: z.string().optional(),
    callbackDelivery: z.enum(['polling', 'webhook']).optional(),
  }),
  notifyMessages: z.boolean().default(true),
  notifyApprovals: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

function parseNotificationConfig(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') config[key] = value;
    }
    return config;
  } catch {
    return {};
  }
}

function mergeNotificationConfig(
  existingJson: string,
  patch: Record<string, string | undefined>,
): string {
  const merged = parseNotificationConfig(existingJson);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  return JSON.stringify(merged);
}

function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/…`;
  } catch {
    return '[configured]';
  }
}

interface NotificationChannelPublicConfig {
  chatId?: string;
  phone?: string;
  webhookUrl?: string;
  callbackDelivery?: 'polling' | 'webhook';
  botTokenConfigured?: boolean;
  apiKeyConfigured?: boolean;
}

interface NotificationChannelPublic {
  id: string;
  organizationId: string;
  provider: NotificationChannelRow['provider'];
  config: NotificationChannelPublicConfig;
  enabled: boolean;
  notifyMessages: boolean;
  notifyApprovals: boolean;
  createdAt: string;
  updatedAt: string;
}

function toNotificationChannelPublic(channel: NotificationChannelRow): NotificationChannelPublic {
  const stored = parseNotificationConfig(channel.configJson);
  const config: NotificationChannelPublicConfig = {};
  if (stored.chatId) config.chatId = stored.chatId;
  if (stored.phone) config.phone = stored.phone;
  if (stored.webhookUrl) config.webhookUrl = maskWebhookUrl(stored.webhookUrl);
  if (stored.callbackDelivery === 'polling' || stored.callbackDelivery === 'webhook') {
    config.callbackDelivery = stored.callbackDelivery;
  }
  if (stored.botToken) config.botTokenConfigured = true;
  if (stored.apiKey) config.apiKeyConfigured = true;
  return {
    id: channel.id,
    organizationId: channel.organizationId,
    provider: channel.provider,
    config,
    enabled: channel.enabled,
    notifyMessages: channel.notifyMessages,
    notifyApprovals: channel.notifyApprovals,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

const UpdateChannelSchema = z.object({
  config: z.object({
    webhookUrl: z.string().optional(),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    phone: z.string().optional(),
    apiKey: z.string().optional(),
    callbackDelivery: z.enum(['polling', 'webhook']).optional(),
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
  const app = api.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, deps);

  // Called by Telegram servers (no session/bearer). Callback payloads are
  // authenticated via HMAC signatures in resolveApprovalFromTelegram.
  register({
    method: 'post',
    path: '/notifications/telegram-webhook',
    auth: { kind: 'none' },
    schema: {
      description: 'Telegram bot webhook for inline keyboard callbacks',
      tags: ['Notifications'],
    },
    handler: async (req, { reply }) => {
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
    },
  });
}

export function registerNotificationRoutes(api: FastifyInstance, deps: NotificationRouteDeps): void {
  const app = api.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, deps);

  register({
    method: 'get',
    path: '/notifications/channels',
    auth: { kind: 'user' },
    schema: {
      description: 'List notification channels',
      tags: ['Notifications'],
    },
    handler: async (_req, { organizationId }) => {
      const channels = deps.repo
        .listNotificationChannels(organizationId)
        .map(toNotificationChannelPublic);
      return { channels };
    },
  });

  register({
    method: 'post',
    path: '/notifications/channels',
    auth: { kind: 'user' },
    schema: {
      description: 'Create a notification channel',
      tags: ['Notifications'],
    },
    handler: async (req, { organizationId, reply }) => {
      const body = CreateChannelSchema.parse(req.body);
      const now = new Date().toISOString();
      deps.repo.saveNotificationChannel({
        id: randomUUID(),
        organizationId,
        provider: body.provider,
        configJson: JSON.stringify(body.config),
        enabled: body.enabled,
        notifyMessages: body.notifyMessages,
        notifyApprovals: body.notifyApprovals,
        createdAt: now,
        updatedAt: now,
      });
      return reply.status(201).send({ ok: true });
    },
  });

  register({
    method: 'patch',
    path: '/notifications/channels/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Update a notification channel',
      tags: ['Notifications'],
    },
    handler: async (req, { organizationId }) => {
      const { id } = req.params as { id: string };
      const existing = deps.repo.getNotificationChannel(organizationId, id);
      if (!existing) throw httpError(404, 'Channel not found');
      const body = UpdateChannelSchema.parse(req.body);
      deps.repo.saveNotificationChannel({
        ...existing,
        configJson: body.config
          ? mergeNotificationConfig(existing.configJson, body.config)
          : existing.configJson,
        enabled: body.enabled ?? existing.enabled,
        notifyMessages: body.notifyMessages ?? existing.notifyMessages,
        notifyApprovals: body.notifyApprovals ?? existing.notifyApprovals,
        updatedAt: new Date().toISOString(),
      });
      return { ok: true };
    },
  });

  register({
    method: 'delete',
    path: '/notifications/channels/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Delete a notification channel',
      tags: ['Notifications'],
    },
    successStatus: 204,
    handler: async (req, { organizationId }) => {
      const { id } = req.params as { id: string };
      deps.repo.deleteNotificationChannel(organizationId, id);
    },
  });
}