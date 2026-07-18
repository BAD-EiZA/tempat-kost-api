export const JOB_QUEUE_PORT = Symbol('JOB_QUEUE_PORT');

export type JobPayload = Record<string, unknown>;

export interface EnqueueOptions {
  idempotencyKey?: string;
  delayMs?: number;
}

export interface JobQueuePort {
  enqueue(
    topic: string,
    eventType: string,
    payload: JobPayload,
    options?: EnqueueOptions,
  ): Promise<{ id: string }>;
}
