import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiFlashAdapter } from '../ai/gemini-flash.adapter';
import { createEmailAdapter } from '../email/email.factory';
import { EMAIL_PORT } from '../email/email.port';
import { OutboxJobQueueAdapter } from '../jobs/outbox-job-queue.adapter';
import { AI_PROVIDER_PORT } from '../ports/ai-provider.port';
import { JOB_QUEUE_PORT } from '../ports/job-queue.port';
import { STORAGE_PORT } from '../ports/storage.port';
import { CloudinaryAdapter } from '../storage/cloudinary.adapter';

@Global()
@Module({
  providers: [
    { provide: AI_PROVIDER_PORT, useClass: GeminiFlashAdapter },
    {
      provide: JOB_QUEUE_PORT,
      useClass: OutboxJobQueueAdapter,
    },
    { provide: STORAGE_PORT, useClass: CloudinaryAdapter },
    {
      provide: EMAIL_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createEmailAdapter(config),
    },
  ],
  exports: [AI_PROVIDER_PORT, JOB_QUEUE_PORT, STORAGE_PORT, EMAIL_PORT],
})
export class InfraModule {}
