import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EmailMessage, EmailPort } from './email.port';

/** Dev/default: log email instead of sending (set SMTP later). */
@Injectable()
export class LogEmailAdapter implements EmailPort {
  private readonly logger = new Logger(LogEmailAdapter.name);

  async send(message: EmailMessage): Promise<{ id: string; skipped?: boolean }> {
    const id = randomUUID();
    this.logger.log(
      `[email] id=${id} to=${message.to} subject=${message.subject} body=${message.text.slice(0, 200)}`,
    );
    return { id, skipped: true };
  }
}
