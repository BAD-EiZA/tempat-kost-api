import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { randomUUID } from 'crypto';
import { EmailMessage, EmailPort } from './email.port';

@Injectable()
export class SmtpEmailAdapter implements EmailPort {
  private readonly logger = new Logger(SmtpEmailAdapter.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST', '');
    const port = Number(config.get('SMTP_PORT') ?? 587);
    const user = config.get<string>('SMTP_USER') || undefined;
    const pass = config.get<string>('SMTP_PASS') || undefined;
    const secure =
      config.get<string>('SMTP_SECURE') === 'true' || port === 465;
    this.from =
      config.get<string>('SMTP_FROM') ||
      user ||
      'noreply@tempatkost.local';
    this.transport = createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<{ id: string; skipped?: boolean }> {
    const id = randomUUID();
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId: `<${id}@tempatkost>`,
      });
      this.logger.log(
        `[smtp] id=${id} to=${message.to} subject=${message.subject} messageId=${info.messageId}`,
      );
      return { id };
    } catch (e) {
      this.logger.error(
        `[smtp] failed id=${id} to=${message.to}: ${String(e)}`,
      );
      throw e;
    }
  }
}
