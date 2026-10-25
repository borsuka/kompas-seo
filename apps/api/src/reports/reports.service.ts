import { Injectable } from '@nestjs/common';
import { findLocation, type GscPerformance, type RankingsSummary } from '@seo/shared';
import { BacklinksService } from '../backlinks/backlinks.service.js';
import { DomainsService } from '../domains/domains.service.js';
import { GscService } from '../gsc/gsc.service.js';
import type { ResearchContext } from '../keywords/keywords.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { RankingsService } from '../rankings/rankings.service.js';
import { ReportPdf } from './pdf.js';

type Ui = 'bg' | 'en';

const L = {
  bg: {
    title: 'SEO отчет',
    subtitle: (d: string) => `Органична видимост, беклинкове и позиции на ${d}`,
    meta: (date: string, market: string, data: string) =>
      `Изготвен на ${date} · пазар: ${market} · данни от ${data}`,
    footer: 'Kompas SEO',
    organic: 'Органична видимост',
    traffic: 'Органичен трафик/мес.',
    keywords: 'Органични думи',
    top10: 'Думи в топ 10',
    rating: 'Рейтинг на домейна',
    topKeywords: 'Топ ключови думи',
    keyword: 'Ключова дума',
    position: 'Позиция',
    volume: 'Обем',
    trafficCol: 'Трафик',
    topPages: 'Топ страници',
    page: 'Страница',
    backlinks: 'Беклинкове',
    referringDomains: 'Реферални домейни',
    backlinksCount: 'Беклинкове',
    dofollow: 'Dofollow',
    broken: 'Счупени',
    topDomains: 'Топ реферални домейни',
    domain: 'Домейн',
    rankings: 'Проследяване на позиции',
    visibility: 'Видимост',
    avgPosition: 'Средна позиция',
    tracked: 'Следени думи',
    improved: 'Подобрени / влошени',
    movers: 'Най-голяма промяна',
    change: 'Промяна',
    gsc: 'Google Search Console (28 дни)',
    clicks: 'Кликове',
    impressions: 'Импресии',
    ctr: 'CTR',
    query: 'Заявка',
    none: 'Няма данни.',
    estimate: 'Трафикът е оценка: обем × CTR според позицията.',
  },
  en: {
    title: 'SEO report',
    subtitle: (d: string) => `Organic visibility, backlinks and rankings of ${d}`,
    meta: (date: string, market: string, data: string) =>
      `Generated on ${date} · market: ${market} · data from ${data}`,
    footer: 'Kompas SEO',
    organic: 'Organic visibility',
    traffic: 'Organic traffic/mo',
    keywords: 'Organic keywords',
    top10: 'Keywords in top 10',
    rating: 'Domain rating',
    topKeywords: 'Top keywords',
    keyword: 'Keyword',
    position: 'Position',
    volume: 'Volume',
    trafficCol: 'Traffic',
    topPages: 'Top pages',
    page: 'Page',
    backlinks: 'Backlinks',
    referringDomains: 'Referring domains',
    backlinksCount: 'Backlinks',
    dofollow: 'Dofollow',
    broken: 'Broken',
    topDomains: 'Top referring domains',
    domain: 'Domain',
    rankings: 'Rank tracking',
    visibility: 'Visibility',
    avgPosition: 'Average position',
    tracked: 'Tracked keywords',
    improved: 'Improved / declined',
    movers: 'Biggest changes',
    change: 'Change',
    gsc: 'Google Search Console (28 days)',
    clicks: 'Clicks',
    impressions: 'Impressions',
    ctr: 'CTR',
    query: 'Query',
    none: 'No data.',
    estimate: 'Traffic is an estimate: volume × CTR at the position.',
  },
} as const;

/**
 * PDF reports built from the same research as the app (snapshots are reused, so a report
 * on recently analysed data costs no credits).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly domains: DomainsService,
    private readonly backlinks: BacklinksService,
    private readonly rankings: RankingsService,
    private readonly gsc: GscService,
    private readonly projects: ProjectsService,
  ) {}

  async domainReport(
    ctx: ResearchContext,
    q: { domain: string; loc: number; lang: string; projectId?: string; ui: Ui },
  ): Promise<{ filename: string; pdf: Buffer }> {
    const t = L[q.ui];
    const num = new Intl.NumberFormat(q.ui === 'bg' ? 'bg-BG' : 'en-GB');
    const pct = new Intl.NumberFormat(q.ui === 'bg' ? 'bg-BG' : 'en-GB', {
      style: 'percent',
      maximumFractionDigits: 1,
    });
    const dec = new Intl.NumberFormat(q.ui === 'bg' ? 'bg-BG' : 'en-GB', {
      maximumFractionDigits: 1,
    });
    const n = (v: number | null | undefined) =>
      v === null || v === undefined ? '–' : num.format(Math.round(v));
    const pos = (v: number | null | undefined) =>
      v === null || v === undefined ? '–' : dec.format(v);

    const overview = await this.domains.overview(ctx, {
      domain: q.domain,
      loc: q.loc,
      lang: q.lang as 'bg',
    });
    const links = await this.backlinks.overview(ctx, q.domain);
    let ranks: RankingsSummary | null = null;
    let gsc: GscPerformance | null = null;
    if (q.projectId) {
      const project = await this.projects.get(ctx.organizationId, q.projectId);
      ranks = await this.rankings.summary(ctx, project.id, { days: 30 });
      const status = await this.gsc.status(ctx, project.id);
      if (status.status === 'active')
        gsc = await this.gsc.performance(ctx, project.id, {
          days: 28,
          by: 'query',
          page: 1,
          pageSize: 10,
        });
    }

    const market = findLocation(q.loc)?.iso ?? String(q.loc);
    const pdf = new ReportPdf(`${t.title} · ${q.domain}`, `${t.footer} · ${q.domain}`)
      .cover(
        `${t.title}: ${q.domain}`,
        t.subtitle(q.domain),
        t.meta(
          new Date().toISOString().slice(0, 10),
          `${market} · ${q.lang.toUpperCase()}`,
          // Read-only roles may get older stored research: say how old.
          [overview.fetchedAt, links.fetchedAt].sort()[0]!.slice(0, 10),
        ),
      )
      .heading(t.organic)
      .metrics([
        { label: t.traffic, value: n(overview.estTraffic) },
        { label: t.keywords, value: n(overview.organicKeywords) },
        { label: t.top10, value: n(overview.top10) },
        { label: t.rating, value: n(overview.rating) },
      ])
      .note(t.estimate)
      .heading(t.topKeywords)
      .table(
        [
          { header: t.keyword, width: 4, value: (r) => r.keyword },
          { header: t.position, width: 1, align: 'right', value: (r) => pos(r.position) },
          { header: t.volume, width: 1.4, align: 'right', value: (r) => n(r.volume) },
          { header: t.trafficCol, width: 1.4, align: 'right', value: (r) => n(r.traffic) },
        ],
        overview.topKeywords.slice(0, 15),
        t.none,
      )
      .heading(t.topPages)
      .table(
        [
          { header: t.page, width: 5, value: (r) => r.url },
          { header: t.keywords, width: 1.2, align: 'right', value: (r) => n(r.keywords) },
          { header: t.trafficCol, width: 1.2, align: 'right', value: (r) => n(r.traffic) },
        ],
        overview.topPages.slice(0, 10),
        t.none,
      )
      .heading(t.backlinks)
      .metrics([
        { label: t.referringDomains, value: n(links.summary.referringDomains) },
        { label: t.backlinksCount, value: n(links.summary.backlinks) },
        {
          label: t.dofollow,
          value: links.summary.backlinks
            ? pct.format(links.summary.dofollow / links.summary.backlinks)
            : '–',
        },
        { label: t.broken, value: n(links.summary.brokenBacklinks) },
      ])
      .table(
        [
          { header: t.domain, width: 4, value: (r) => r.domain },
          { header: t.rating, width: 1.2, align: 'right', value: (r) => n(r.rating) },
          { header: t.backlinksCount, width: 1.2, align: 'right', value: (r) => n(r.backlinks) },
        ],
        links.topReferringDomains.slice(0, 10),
        t.none,
      );

    if (ranks) {
      pdf
        .heading(t.rankings)
        .metrics([
          { label: t.visibility, value: pct.format(ranks.visibility / 100) },
          {
            label: t.avgPosition,
            value: pos(ranks.avgPosition),
          },
          { label: t.tracked, value: n(ranks.keywords) },
          { label: t.improved, value: `${ranks.improved} / ${ranks.declined}` },
        ])
        .table(
          [
            { header: t.keyword, width: 4, value: (r) => r.keyword },
            {
              header: t.position,
              width: 1.2,
              align: 'right',
              value: (r) => (r.position === null ? '>100' : pos(r.position)),
            },
            {
              header: t.change,
              width: 1.2,
              align: 'right',
              value: (r) => (r.change > 0 ? `+${r.change}` : String(r.change)),
            },
          ],
          [...ranks.movers.up, ...ranks.movers.down],
          t.none,
        );
    }
    if (gsc) {
      pdf
        .heading(t.gsc)
        .metrics([
          { label: t.clicks, value: n(gsc.totals.clicks) },
          { label: t.impressions, value: n(gsc.totals.impressions) },
          { label: t.ctr, value: pct.format(gsc.totals.ctr) },
          {
            label: t.avgPosition,
            value: pos(gsc.totals.position),
          },
        ])
        .table(
          [
            { header: t.query, width: 4, value: (r) => r.key },
            { header: t.clicks, width: 1.2, align: 'right', value: (r) => n(r.clicks) },
            { header: t.impressions, width: 1.4, align: 'right', value: (r) => n(r.impressions) },
            { header: t.position, width: 1.2, align: 'right', value: (r) => pos(r.position) },
          ],
          gsc.rows,
          t.none,
        );
    }
    return {
      filename: `seo-report-${q.domain}-${new Date().toISOString().slice(0, 10)}.pdf`,
      pdf: await pdf.finish(),
    };
  }
}
