import type { ApiRepository } from './repository-reader.js';
import { NotificationService } from './notification.js';

export interface NotificationsDomainInput {
  repo: ApiRepository;
}

export interface NotificationsDomainOutput {
  notifications: NotificationService;
}

export function createNotificationsDomain(input: NotificationsDomainInput): NotificationsDomainOutput {
  const notifications = new NotificationService(input.repo);
  return { notifications };
}
