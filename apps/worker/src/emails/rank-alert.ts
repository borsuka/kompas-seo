import type { RankAlertType, UiLocale } from '@seo/shared';
import type { EmailContent } from '../mailer.js';

const APP_NAME = 'Kompas SEO';
const MAX_ROWS = 50;

export interface RankAlertLine {
  keyword: string;
  device: 'desktop' | 'mobile';
  previousPosition: number | null;
  position: number | null;
}

const copy = {
  bg: {
    subject: (project: string, n: number) => `Промени в позициите: ${project} (${n})`,
    intro: (project: string) =>
      `При днешната проверка на „${project}“ сработиха следните известия:`,
    rule: {
      position_drop: (n: number) => `Спад с поне ${n} позиции`,
      position_gain: (n: number) => `Ръст с поне ${n} позиции`,
      enter_top: (n: number) => `Влизане в топ ${n}`,
      leave_top: (n: number) => `Излизане от топ ${n}`,
    },
    head: ['Ключова дума', 'Устройство', 'Беше', 'Сега'],
    device: { desktop: 'компютър', mobile: 'мобилно' },
    notRanked: 'извън топ 100',
    more: (n: number) => `…и още ${n}`,
    cta: 'Отвори позициите',
    footer: 'Получавате този имейл, защото адресът ви е добавен към известие в проекта.',
  },
  en: {
    subject: (project: string, n: number) => `Ranking changes: ${project} (${n})`,
    intro: (project: string) => `Today's check of "${project}" triggered these alerts:`,
    rule: {
      position_drop: (n: number) => `Dropped by at least ${n} positions`,
      position_gain: (n: number) => `Gained at least ${n} positions`,
      enter_top: (n: number) => `Entered the top ${n}`,
      leave_top: (n: number) => `Left the top ${n}`,
    },
    head: ['Keyword', 'Device', 'Was', 'Now'],
    device: { desktop: 'desktop', mobile: 'mobile' },
    notRanked: 'not in top 100',
    more: (n: number) => `…and ${n} more`,
    cta: 'Open rankings',
    footer: 'You receive this email because your address was added to an alert in this project.',
  },
} as const;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One digest per alert rule and check. */
export function rankAlertEmail(opts: {
  locale: UiLocale;
  projectName: string;
  type: RankAlertType;
  threshold: number;
  lines: readonly RankAlertLine[];
  url: string;
}): EmailContent {
  const c = copy[opts.locale];
  const pos = (p: number | null) => (p === null ? c.notRanked : String(p));
  const shown = opts.lines.slice(0, MAX_ROWS);
  const rest = opts.lines.length - shown.length;
  const rule = c.rule[opts.type](opts.threshold);

  const text = [
    c.intro(opts.projectName),
    '',
    rule,
    ...shown.map(
      (l) =>
        `- ${l.keyword} (${c.device[l.device]}): ${pos(l.previousPosition)} → ${pos(l.position)}`,
    ),
    rest > 0 ? c.more(rest) : '',
    '',
    `${c.cta}: ${opts.url}`,
    '',
    c.footer,
  ].join('\n');

  const cell = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px';
  const rows = shown
    .map(
      (l) =>
        `<tr><td style="${cell}">${esc(l.keyword)}</td><td style="${cell}">${c.device[l.device]}</td>` +
        `<td style="${cell};text-align:right">${pos(l.previousPosition)}</td>` +
        `<td style="${cell};text-align:right;font-weight:600">${pos(l.position)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;padding:24px;color:#111827">
<table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:32px">
<tr><td>
<p style="font-weight:600;font-size:14px;color:#4b5563;margin:0 0 24px">${APP_NAME}</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 8px">${esc(c.intro(opts.projectName))}</p>
<h1 style="font-size:17px;margin:0 0 12px">${esc(rule)}</h1>
<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 16px">
<tr>${c.head.map((h, i) => `<th style="${cell};text-align:${i > 1 ? 'right' : 'left'};color:#6b7280">${h}</th>`).join('')}</tr>
${rows}
</table>
${rest > 0 ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px">${esc(c.more(rest))}</p>` : ''}
<p style="margin:0 0 24px"><a href="${esc(opts.url)}" style="display:inline-block;background:#1f2937;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">${esc(c.cta)}</a></p>
<p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0">${esc(c.footer)}</p>
</td></tr></table></body></html>`;

  return { subject: `${c.subject(opts.projectName, opts.lines.length)} · ${APP_NAME}`, text, html };
}
