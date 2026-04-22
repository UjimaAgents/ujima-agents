import type { FastifyInstance, FastifyReply } from 'fastify';
import { TaskPromotionRequestSchema } from '@ujima/api-schema';
import type { TaskPromoterService } from '@ujima/orchestrator';

export interface TaskRoutesOptions {
  taskPromoter: TaskPromoterService;
}

export function registerTaskRoutes(app: FastifyInstance, options: TaskRoutesOptions): void {
  const { taskPromoter } = options;

  app.post('/api/tasks/promote', async (req, reply) => {
    const body = TaskPromotionRequestSchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error.message);
    try {
      return await taskPromoter.promote(body.data);
    } catch (err) {
      const message = errMessage(err);
      const code = message.startsWith('Organization not found')
        ? 404
        : message.startsWith('No agent member available')
          ? 409
          : 400;
      const auditEventId = (err as { auditEventId?: string }).auditEventId;
      return reply.code(code).send({ error: message, auditEventId });
    }
  });
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
