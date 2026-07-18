import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  EnqueueOptions,
  JobPayload,
  JobQueuePort,
} from '../ports/job-queue.port';

@Injectable()
export class MemoryJobQueueAdapter implements JobQueuePort {
  private readonly logger = new Logger(MemoryJobQueueAdapter.name);

  async enqueue(
    topic: string,
    eventType: string,
    payload: JobPayload,
    options?: EnqueueOptions,
  ): Promise<{ id: string }> {
    const id = options?.idempotencyKey ?? randomUUID();
    this.logger.debug(
      `enqueue topic=${topic} event=${eventType} id=${id} payloadKeys=${Object.keys(payload).join(',')}`,
    );
    return { id };
  }
}
