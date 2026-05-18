import { z } from 'zod';
import type { OrchestratorTool, ToolExecutionContext } from './types.js';
import { errorMessage } from '../utils/error-message.js';

// supervisor.todo.* — the supervisor's only side-effect tool family.
//
// A supervisor's job is to answer DMs/@mentions about an active task and
// optionally jot a working item the worker should pick up next turn. Per
// the plan (E4.2.5) the supervisor's tool allowlist is intentionally
// tiny — `self.note`, channel reads, the channel-post/dm answer path,
// and these three todo tools — so it can't run shell, write files, or
// otherwise do work the worker is responsible for.
//
// `taskSessionId` rides on the ToolInvocationInput, not the tool args.
// The supervisor turn knows the session it's answering for; the model
// shouldn't have to pass it. If no `taskSessionId` is in scope we
// reject the call instead of silently writing an unscoped row, which
// would otherwise leak across sessions on the next list().
//
// All three tools delegate to `SupervisorTodoService` (Phase 2.B.1) so
// the cross-session invariant lives in one place and the tool layer
// stays a thin shim.

const TodoAddSchema = z.object({
  body: z.string().min(1),
  notes: z.string().optional(),
});

const TodoCheckSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).default('completed'),
  notes: z.string().optional(),
});

const TodoListSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
});

function requireTaskSessionId(invocation: { taskSessionId?: string }): string {
  if (!invocation.taskSessionId) {
    throw new Error('supervisor.todo.* requires an active task_session_id on the invocation');
  }
  return invocation.taskSessionId;
}

function requireSupervisorTodos(ctx: ToolExecutionContext) {
  if (!ctx.supervisorTodos) {
    throw new Error('supervisor.todo.* tools require SupervisorTodoService on ToolExecutionContext');
  }
  return ctx.supervisorTodos;
}

export const supervisorTodoAddTool: OrchestratorTool<typeof TodoAddSchema> = {
  id: 'supervisor.todo.add',
  schema: TodoAddSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    permissionMcpId: 'supervisor',
    // Always allowed — the supervisor's right to take a working note is
    // structural, same rationale as `self.note`.
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const taskSessionId = requireTaskSessionId(ctx.invocation);
    const service = requireSupervisorTodos(ctx);
    const todo = service.add({
      organizationId: ctx.invocation.organizationId,
      taskSessionId,
      memberId: ctx.invocation.memberId,
      runId: ctx.invocation.runId || undefined,
      body: String(ctx.invocation.input.body),
      notes:
        typeof ctx.invocation.input.notes === 'string' ? ctx.invocation.input.notes : undefined,
    });
    return { todo };
  },
};

export const supervisorTodoCheckTool: OrchestratorTool<typeof TodoCheckSchema> = {
  id: 'supervisor.todo.check',
  schema: TodoCheckSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    permissionMcpId: 'supervisor',
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const taskSessionId = requireTaskSessionId(ctx.invocation);
    const service = requireSupervisorTodos(ctx);
    try {
      const todo = service.check({
        organizationId: ctx.invocation.organizationId,
        taskSessionId,
        todoId: String(ctx.invocation.input.id),
        status: ctx.invocation.input.status as
          | 'pending'
          | 'in_progress'
          | 'completed'
          | 'cancelled'
          | undefined,
        notes:
          typeof ctx.invocation.input.notes === 'string'
            ? ctx.invocation.input.notes
            : undefined,
      });
      return { todo };
    } catch (err) {
      return { error: errorMessage(err) };
    }
  },
};

export const supervisorTodoListTool: OrchestratorTool<typeof TodoListSchema> = {
  id: 'supervisor.todo.list',
  schema: TodoListSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    permissionMcpId: 'supervisor',
    bypassPermission: true,
    input: args,
  }),
  execute: (ctx) => {
    const taskSessionId = requireTaskSessionId(ctx.invocation);
    const service = requireSupervisorTodos(ctx);
    const todos = service.list({
      organizationId: ctx.invocation.organizationId,
      taskSessionId,
      status: ctx.invocation.input.status as
        | 'pending'
        | 'in_progress'
        | 'completed'
        | 'cancelled'
        | undefined,
    });
    return { todos };
  },
};
