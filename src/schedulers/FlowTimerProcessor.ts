/**
 * @fileoverview Flow Timer Processor — BullMQ worker for timer nodes.
 *
 * When a timer job fires, it resumes the flow execution by producing
 * a flow.step.ready event to Kafka.
 *
 * @module schedulers/FlowTimerProcessor
 */

import { Worker, type Job } from 'bullmq';
import { FLOW_TIMER_QUEUE } from '../services/TimerService.js';
import { FlowExecutionRepository } from '../repositories/FlowExecutionRepository.js';
import { FlowRepository } from '../repositories/FlowRepository.js';
import { produceFlowStepReady } from '../kafka/producers/FlowEventProducer.js';
import { redis } from '../config/redis.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('FlowTimerProcessor');

export class FlowTimerProcessor {
  private worker: Worker | null = null;
  private readonly executionRepo: FlowExecutionRepository;
  private readonly flowRepo: FlowRepository;

  constructor() {
    this.executionRepo = new FlowExecutionRepository();
    this.flowRepo = new FlowRepository();
  }

  start(): void {
    if (!redis) {
      log.warn('Redis not available — flow timer processor disabled');
      return;
    }

    this.worker = new Worker(
      FLOW_TIMER_QUEUE,
      async (job: Job) => {
        await this.processTimerJob(job);
      },
      {
        connection: redis,
        concurrency: 10,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );

    this.worker.on('completed', (job) => {
      log.debug({ jobId: job.id }, 'Timer job completed');
    });

    this.worker.on('failed', (job, err) => {
      log.error({ jobId: job?.id, err }, 'Timer job failed');
    });

    log.info('Flow timer processor started');
  }

  private async processTimerJob(job: Job): Promise<void> {
    const { executionId, nodeId } = job.data as { executionId: string; nodeId: string };

    log.info({ executionId, nodeId }, 'Timer fired — resuming flow execution');

    // Load execution and verify it's still active
    const execution = await this.executionRepo.findOne('', { _id: executionId } as any);
    if (!execution) {
      log.warn({ executionId }, 'Execution not found — timer job abandoned');
      return;
    }

    if (execution.status !== 'active') {
      log.info({ executionId, status: execution.status }, 'Execution no longer active — skipping');
      return;
    }

    // Load flow to find the next node after the timer
    const flow = await this.flowRepo.findById(
      execution.restaurantId.toString(),
      execution.flowId.toString(),
    );
    if (!flow) {
      log.error({ executionId, flowId: execution.flowId }, 'Flow not found');
      return;
    }

    // Find the outgoing edge from the timer node
    const edge = flow.edges.find((e) => e.sourceNodeId === nodeId);
    if (!edge) {
      // No outgoing edge — timer was the last node
      await this.executionRepo.markCompleted(executionId);
      await this.flowRepo.recordCompletion(execution.flowId.toString());
      log.info({ executionId }, 'No outgoing edge from timer — execution completed');
      return;
    }

    // Advance to the next node
    await this.executionRepo.advanceToNode(executionId, edge.targetNodeId);

    // Produce flow.step.ready event
    await produceFlowStepReady(executionId, edge.targetNodeId);
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      log.info('Flow timer processor stopped');
    }
  }
}
