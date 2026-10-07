import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/** Truncates every application table. Only for test databases. */
export async function truncateAll(db: Database): Promise<void> {
  const res = await db.execute<{ current_database: string }>(sql`select current_database()`);
  const name = res.rows[0]?.current_database ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to truncate non-test database "${name}"`);
  }
  await db.execute(sql`
    truncate table
      audit_log, jobs, credit_ledger, org_credit_balances, subscriptions,
      project_competitors, projects, invitation, member, organization,
      verification, account, session, "user"
    restart identity cascade
  `);
}
