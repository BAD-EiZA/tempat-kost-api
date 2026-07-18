import { ConfigService } from '@nestjs/config';
import { LogEmailAdapter } from './log-email.adapter';
import { SmtpEmailAdapter } from './smtp-email.adapter';
import type { EmailPort } from './email.port';

/** SMTP if SMTP_HOST set; else log-only. */
export function createEmailAdapter(config: ConfigService): EmailPort {
  const host = (config.get<string>('SMTP_HOST') ?? '').trim();
  if (host) {
    return new SmtpEmailAdapter(config);
  }
  return new LogEmailAdapter();
}
