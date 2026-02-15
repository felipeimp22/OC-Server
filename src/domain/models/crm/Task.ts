/**
 * @fileoverview CRM Task Mongoose model.
 * Collection: `crm_tasks`
 *
 * Tasks are internal to-do items created by flows or manually by restaurant staff.
 * The `create_task` action node in a flow can create tasks (e.g., "Call customer
 * to follow up on large order"). Tasks can be assigned to specific users.
 *
 * Completing a task emits a `task_completed` event that can trigger other flows.
 *
 * @module domain/models/crm/Task
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Task priority levels */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Task statuses */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/** TypeScript interface for the CRM Task document */
export interface ITaskDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Task title */
  title: string;
  /** Optional long-form description */
  description: string | null;
  /** Task priority */
  priority: TaskPriority;
  /** Current status */
  status: TaskStatus;
  /** Contact this task is related to (if any) */
  contactId: Types.ObjectId | null;
  /** User assigned to this task (ref → UserRestaurant.userId) */
  assignedTo: Types.ObjectId | null;
  /** Flow execution that created this task (if created by a flow) */
  flowExecutionId: Types.ObjectId | null;
  /** Due date */
  dueAt: Date | null;
  /** Completion timestamp */
  completedAt: Date | null;
  /** User who completed the task */
  completedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITaskDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
    },
    contactId: { type: Schema.Types.ObjectId, default: null },
    assignedTo: { type: Schema.Types.ObjectId, default: null },
    flowExecutionId: { type: Schema.Types.ObjectId, default: null },
    dueAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, default: null },
  },
  {
    collection: 'crm_tasks',
    timestamps: true,
  },
);

/** For listing tasks per restaurant */
TaskSchema.index({ restaurantId: 1, status: 1 });
/** For listing tasks assigned to a user */
TaskSchema.index({ restaurantId: 1, assignedTo: 1, status: 1 });
/** For listing tasks related to a contact */
TaskSchema.index({ contactId: 1 });
/** For finding overdue tasks */
TaskSchema.index({ status: 1, dueAt: 1 });

export const Task = mongoose.model<ITaskDocument>('CrmTask', TaskSchema);
