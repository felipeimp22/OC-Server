/**
 * @fileoverview Queue abstraction layer.
 *
 * Defines a port interface for message queues so the print system
 * (and any future queue consumers) can swap backends (Kafka, Mongo)
 * by changing only the adapter.
 *
 * @module ports/QueuePort
 */

/**
 * A message that can be published to or consumed from a queue.
 */
export interface QueueMessage {
  /** Partition key — typically restaurantId for locality */
  key: string;
  /** Serializable payload */
  value: Record<string, unknown>;
  /** Optional metadata headers (e.g., timestamps, error info) */
  headers?: Record<string, string>;
}

/**
 * Callback invoked for each consumed message.
 */
export type MessageHandler = (message: QueueMessage) => Promise<void>;

/**
 * Options for the consume() method.
 */
export interface ConsumeOptions {
  /** Max messages processed in parallel (default: 1) */
  concurrency?: number;
  /** Max retry attempts before dead-lettering (default: 3) */
  retries?: number;
  /** Topic to route permanently failed messages to */
  deadLetterTopic?: string;
  /** Consumer group identifier */
  groupId?: string;
}

/**
 * Abstract queue port.
 *
 * Adapters (Kafka, Mongo, etc.) implement this interface so the
 * application layer is decoupled from any specific queue backend.
 */
export interface QueuePort {
  /**
   * Publish a message to the given topic.
   */
  publish(topic: string, message: QueueMessage): Promise<void>;

  /**
   * Subscribe to a topic and process messages via the handler.
   */
  consume(topic: string, handler: MessageHandler, options?: ConsumeOptions): Promise<void>;

  /**
   * Gracefully disconnect all producers/consumers managed by this adapter.
   */
  disconnect(): Promise<void>;
}
