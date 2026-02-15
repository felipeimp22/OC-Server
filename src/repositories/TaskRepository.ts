/**
 * @fileoverview CRM Task repository.
 *
 * @module repositories/TaskRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { Task, type ITaskDocument } from '../domain/models/crm/Task.js';

export class TaskRepository extends BaseRepository<ITaskDocument> {
  constructor() {
    super(Task, 'TaskRepository');
  }

  /**
   * Find tasks assigned to a specific user.
   */
  async findByAssignee(
    restaurantId: Types.ObjectId | string,
    assignedTo: Types.ObjectId | string,
    status?: string,
  ): Promise<ITaskDocument[]> {
    const filter: FilterQuery<ITaskDocument> = { assignedTo };
    if (status) {
      filter.status = status;
    }
    return this.find(restaurantId, filter);
  }

  /**
   * Find tasks related to a contact.
   */
  async findByContact(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
  ): Promise<ITaskDocument[]> {
    return this.find(restaurantId, { contactId } as FilterQuery<ITaskDocument>);
  }

  /**
   * Find overdue tasks.
   */
  async findOverdue(restaurantId: Types.ObjectId | string): Promise<ITaskDocument[]> {
    return this.find(restaurantId, {
      status: { $in: ['pending', 'in_progress'] },
      dueAt: { $lt: new Date() },
    } as FilterQuery<ITaskDocument>);
  }

  /**
   * Mark a task as completed.
   */
  async markCompleted(
    restaurantId: Types.ObjectId | string,
    taskId: Types.ObjectId | string,
    completedBy: Types.ObjectId | string,
  ): Promise<ITaskDocument | null> {
    return this.updateById(restaurantId, taskId, {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        completedBy,
      },
    });
  }
}
