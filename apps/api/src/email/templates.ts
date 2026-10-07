import type { UiLocale } from '@seo/shared';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const APP_NAME = 'Kompas SEO';

function layout(
  title: string,
  body: string,
  cta: { url: string; label: string },
  footer: string,
): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;padding:24px;color:#111827">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:32px">
<tr><td>
<p style="font-weight:600;font-size:14px;color:#4b5563;margin:0 0 24px">${APP_NAME}</p>
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 24px">${esc(body)}</p>
<p style="margin:0 0 24px"><a href="${esc(cta.url)}" style="display:inline-block;background:#1f2937;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">${esc(cta.label)}</a></p>
<p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0">${esc(footer)}<br>${esc(cta.url)}</p>
</td></tr></table></body></html>`;
}

function build(
  title: string,
  body: string,
  url: string,
  label: string,
  footer: string,
): EmailContent {
  return {
    subject: `${title} · ${APP_NAME}`,
    text: `${title}\n\n${body}\n\n${label}: ${url}\n\n${footer}`,
    html: layout(title, body, { url, label }, footer),
  };
}

const copy = {
  bg: {
    footer: 'Ако не сте поискали това, игнорирайте имейла. Линкът е валиден ограничено време.',
    verify: [
      'Потвърдете имейла си',
      'Благодарим за регистрацията! Потвърдете адреса си, за да започнете.',
      'Потвърди имейла',
    ],
    magic: ['Вход в акаунта', 'Използвайте бутона по-долу, за да влезете без парола.', 'Вход'],
    reset: ['Смяна на паролата', 'Получихме заявка за смяна на паролата ви.', 'Задай нова парола'],
    invite: (org: string, inviter: string, role: string) =>
      [
        `Покана за ${org}`,
        `${inviter} ви кани да се присъедините към „${org}“ с роля ${role}.`,
        'Приеми поканата',
      ] as const,
    roles: {
      owner: 'собственик',
      admin: 'администратор',
      member: 'член',
      viewer: 'наблюдател',
    } as Record<string, string>,
  },
  en: {
    footer: "If you didn't request this, you can ignore this email. The link expires soon.",
    verify: [
      'Confirm your email',
      'Thanks for signing up! Confirm your address to get started.',
      'Confirm email',
    ],
    magic: [
      'Sign in to your account',
      'Use the button below to sign in without a password.',
      'Sign in',
    ],
    reset: [
      'Reset your password',
      'We received a request to reset your password.',
      'Set a new password',
    ],
    invite: (org: string, inviter: string, role: string) =>
      [
        `Invitation to ${org}`,
        `${inviter} invited you to join "${org}" as ${role}.`,
        'Accept invitation',
      ] as const,
    roles: { owner: 'owner', admin: 'admin', member: 'member', viewer: 'viewer' } as Record<
      string,
      string
    >,
  },
} as const;

export const emailTemplates = {
  verifyEmail: (locale: UiLocale, url: string) => {
    const c = copy[locale];
    return build(c.verify[0], c.verify[1], url, c.verify[2], c.footer);
  },
  magicLink: (locale: UiLocale, url: string) => {
    const c = copy[locale];
    return build(c.magic[0], c.magic[1], url, c.magic[2], c.footer);
  },
  resetPassword: (locale: UiLocale, url: string) => {
    const c = copy[locale];
    return build(c.reset[0], c.reset[1], url, c.reset[2], c.footer);
  },
  invitation: (locale: UiLocale, url: string, org: string, inviter: string, role: string) => {
    const c = copy[locale];
    const [title, body, label] = c.invite(org, inviter, c.roles[role] ?? role);
    return build(title, body, url, label, c.footer);
  },
};
