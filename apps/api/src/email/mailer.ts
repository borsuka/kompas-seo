import nodemailer, { type Transporter } from 'nodemailer';
import type { ApiEnv } from '../config/env.js';
import type { EmailContent } from './templates.js';

export interface Mailer {
  send(to: string, content: EmailContent): Promise<void>;
}

export function createMailer(env: ApiEnv): Mailer {
  const transport: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
  });
  return {
    async send(to, content) {
      await transport.sendMail({ from: env.EMAIL_FROM, to, ...content });
    },
  };
}
