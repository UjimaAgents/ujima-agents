import { randomUUID } from 'node:crypto';
import { TodoSchema, type Todo, type TodoStatus } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

// ---------------------------------------------------------------------
// SupervisorTodoService — Phase 2.B.1
//
// Thin service wrapping the `todos` repo to back the `supervisor.todo.*`
// tools. The service exists for two reasons:
//
//   1. The tools shouldn't know about repo plumbing — they should ask a
//      supervisor-shaped surface for "add this", "check that", "list for
//      this session".
//   2. Cross-session writes are a structural concern (a supervisor
//      mutating a todo from another session would be a privilege escape).
//      Centralising the rule here means the tool layer stays dumb and
//      the service is the single place to audit/extend the invariant.
// ---------------------------------------------------------------------

export interface SupervisorTodoAddInput {
  organizationId: string;
  taskSessionId: string;
  memberId: string;
  runId?: string;
  body: string;
  notes?: string;
}

export interface SupervisorTodoCheckInput {
  organizationId: string;
  taskSessionId: string;
  todoId: string;
  status?: TodoStatus;
  notes?: string;
}

export interface SupervisorTodoListInput {
  organizationId: string;
  taskSessionId: string;
  status?: TodoStatus;
  memberId?: string;
}

export class SupervisorTodoService {
  constructor(private readonly repo: ApiRepository) {}

  add(input: SupervisorTodoAddInput): Todo {
    const now = new Date().toISOString();
    const todo = TodoSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      runId: input.runId,
      memberId: input.memberId,
      title: input.body,
      status: 'pending' as TodoStatus,
      notes: input.notes ?? '',
      createdAt: now,
      updatedAt: now,
    });
    this.repo.saveTodo(todo);
    return todo;
  }

  check(input: SupervisorTodoCheckInput): Todo {
    const existing = this.repo.getTodo(input.organizationId, input.todoId);
    if (!existing) {
      throw new Error(`todo not found: ${input.todoId}`);
    }
    // Cross-session writes are a privilege escape. The supervisor turn
    // pins the active task session id on the invocation; only todos
    // pinned to that same session may be mutated.
    if (existing.taskSessionId && existing.taskSessionId !== input.taskSessionId) {
      throw new Error(
        `todo "${input.todoId}" belongs to a different task session — supervisor cannot mutate it`,
      );
    }
    const status = input.status ?? 'completed';
    const updated = this.repo.updateTodoStatus(input.organizationId, input.todoId, status, {
      notes: input.notes,
    });
    if (!updated) {
      throw new Error(`todo not found after status update: ${input.todoId}`);
    }
    return updated;
  }

  list(input: SupervisorTodoListInput): Todo[] {
    return this.repo.listTodosForSession(input.organizationId, input.taskSessionId, {
      status: input.status,
      memberId: input.memberId,
    });
  }
}
