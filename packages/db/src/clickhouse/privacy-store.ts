import type { ClickHouseClient } from './client.js';

/** Project-scoped analytics tables (deleted with the project's organization). */
const PROJECT_TABLES = ['rank_history', 'rank_competitor_history', 'gsc_daily'] as const;

/** Deletes all project-scoped ClickHouse rows (GDPR erasure, organization deletion). */
export async function deleteProjectAnalytics(ch: ClickHouseClient, projectIds: readonly string[]) {
  if (!projectIds.length) return;
  for (const table of PROJECT_TABLES)
    await ch.command({
      query: `ALTER TABLE ${table} DELETE WHERE project_id IN {ids:Array(UUID)}`,
      query_params: { ids: projectIds },
      // Wait for the mutation: erasure must be complete when the request returns.
      clickhouse_settings: { mutations_sync: '1' },
    });
}

/** Rank history of projects for a data export (latest check per day). */
export async function exportRankHistory(ch: ClickHouseClient, projectIds: readonly string[]) {
  if (!projectIds.length) return [];
  return ch
    .query({
      query: `SELECT toString(project_id) AS project, keyword, device, location_code, language_code,
                     toString(date) AS day, argMax(tuple(position), checked_at).1 AS last_position,
                     argMax(url, checked_at) AS last_url
              FROM rank_history WHERE project_id IN {ids:Array(UUID)}
              GROUP BY project_id, keyword, device, location_code, language_code, date
              ORDER BY project_id, keyword, date`,
      query_params: { ids: projectIds },
      format: 'JSONEachRow',
    })
    .then((r) => r.json<Record<string, unknown>>());
}
