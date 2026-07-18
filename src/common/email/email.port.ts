export const EMAIL_PORT = Symbol('EMAIL_PORT');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<{ id: string; skipped?: boolean }>;
}
