import { randomUUID } from 'node:crypto';
import type {
  ChildTask,
  ChildTaskStatus,
  ChildTaskWaitMode,
  DelegateKind,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

const CHILD_TASK_FALLBACK = new Map<string, ChildTask>();

function childTaskKey(organizationId: string, taskId: string): string {
  return `${organizationId}:${taskId}`;
}

export class ChildTaskService {
  constructor(private repo: ApiRepository) {}

  private save(task: ChildTask): ChildTask {
    if (this.repo.saveChildTask) {
      return this.repo.saveChildTask(task);
    }
    CHILD_TASK_FALLBACK.set(childTaskKey(task.organizationId, task.id), task);
    return task;
  }

  private patch(
    organizationId: string,
    taskId: string,
    updates: Partial<ChildTask>,
  ): ChildTask | null {
    if (this.repo.updateChildTask) {
      return this.repo.updateChildTask(organizationId, taskId, updates);
    }
    const current = this.getChildTask(organizationId, taskId);
    if (!current) return null;
    const next = { ...current, ...updates };
    CHILD_TASK_FALLBACK.set(childTaskKey(organizationId, taskId), next);
    return next;
  }

  createChildTask(input: {
    id?: string;
    organizationId: string;
    parentRunId: string;
    parentMemberId: string;
    targetAgentId: string;
    targetAgentKind?: DelegateKind;
    threadId: string;
    waitMode?: ChildTaskWaitMode;
    label?: string;
    keepAgent?: boolean;
  }): ChildTask {
    const now = new Date().toISOString();
    const task: ChildTask = {
      id: input.id ?? randomUUID(),
      organizationId: input.organizationId,
      parentRunId: input.parentRunId,
      parentMemberId: input.parentMemberId,
      targetAgentId: input.targetAgentId,
      targetAgentKind: input.targetAgentKind ?? 'worker',
      threadId: input.threadId,
      status: 'queued',
      waitMode: input.waitMode ?? 'wait',
      label: input.label ?? '',
      result: '',
      error: '',
      keepAgent: input.keepAgent ?? false,
      createdAt: now,
      updatedAt: now,
    };
    return this.save(task);
  }

  getChildTask(organizationId: string, taskId: string): ChildTask | null {
    if (this.repo.getChildTask) {
      return this.repo.getChildTask(organizationId, taskId);
    }
    return CHILD_TASK_FALLBACK.get(childTaskKey(organizationId, taskId)) ?? null;
  }

  listByParentRun(organizationId: string, parentRunId: string): ChildTask[] {
    if (this.repo.listChildTasksByParentRun) {
      return this.repo.listChildTasksByParentRun(organizationId, parentRunId);
    }
    return [...CHILD_TASK_FALLBACK.values()].filter(
      (task) => task.organizationId === organizationId && task.parentRunId === parentRunId,
    );
  }

  listByTargetAgent(organizationId: string, targetAgentId: string): ChildTask[] {
    if (this.repo.listChildTasksByTargetAgent) {
      return this.repo.listChildTasksByTargetAgent(organizationId, targetAgentId);
    }
    return [...CHILD_TASK_FALLBACK.values()].filter(
      (task) => task.organizationId === organizationId && task.targetAgentId === targetAgentId,
    );
  }

  updateStatus(
    organizationId: string,
    taskId: string,
    status: ChildTaskStatus,
  ): ChildTask | null {
    const updates: Partial<ChildTask> = {
      status,
      updatedAt: new Date().toISOString(),
    };
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.completedAt = new Date().toISOString();
    }
    return this.patch(organizationId, taskId, updates);
  }

  recordResult(
    organizationId: string,
    taskId: string,
    result: string,
  ): ChildTask | null {
    return this.patch(organizationId, taskId, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  setError(
    organizationId: string,
    taskId: string,
    error: string,
  ): ChildTask | null {
    return this.patch(organizationId, taskId, {
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}
