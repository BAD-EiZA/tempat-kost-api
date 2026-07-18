import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  EnqueueOptions,
  JobPayload,
  JobQueuePort,
} from '../ports/job-queue.port';

/**
 * Durable-ish queue: write domain_outbox, process via cron poll.
 * Replaces pure memory for export/email/AI side-effects.
 */
@Injectable()
export class OutboxJobQueueAdapter implements JobQueuePort {
  private readonly logger = new Logger(OutboxJobQueueAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(
    topic: string,
    eventType: string,
    payload: JobPayload,
    options?: EnqueueOptions,
  ): Promise<{ id: string }> {
    const id = options?.idempotencyKey ?? randomUUID();
    try {
      await this.prisma.domainOutbox.create({
        data: {
          workspaceId:
            typeof payload.workspaceId === 'string'
              ? payload.workspaceId
              : null,
          topic,
          eventType,
          payload: payload as object,
          idempotencyKey: id,
        },
      });
    } catch {
      this.logger.debug(`outbox duplicate or fail id=${id}`);
    }
    return { id };
  }
}
