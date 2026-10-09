import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, schema, sql, type Database } from '@seo/db';
import {
  deleteProjectAnalytics,
  exportRankHistory,
  type ClickHouseClient,
} from '@seo/db/clickhouse';
import { AppError } from '@seo/shared';
import { AuditService } from '../audit/audit.service.js';
import { CLICKHOUSE, DB } from '../infra/tokens.js';

const stripSecrets = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]) => {
  const copy = { ...row };
  for (const k of keys) delete copy[k];
  return copy;
};

/**
 * GDPR: data export (Art. 15/20) and erasure (Art. 17) for users and organizations.
 * Secrets (password hashes, OAuth tokens, API key hashes) are never exported.
 */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    private readonly audit: AuditService,
  ) {}

  async exportUser(userId: string) {
    const [user] = await this.db.select().from(schema.user).where(eq(schema.user.id, userId));
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const memberships = await this.db
      .select({
        organizationId: schema.organization.id,
        organization: schema.organization.name,
        role: schema.member.role,
        joinedAt: schema.member.createdAt,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, userId));
    const accounts = await this.db
      .select({ providerId: schema.account.providerId, createdAt: schema.account.createdAt })
      .from(schema.account)
      .where(eq(schema.account.userId, userId));
    const sessions = await this.db
      .select({
        createdAt: schema.session.createdAt,
        expiresAt: schema.session.expiresAt,
        ipAddress: schema.session.ipAddress,
        userAgent: schema.session.userAgent,
      })
      .from(schema.session)
      .where(eq(schema.session.userId, userId));
    const activity = await this.db
      .select({
        organizationId: schema.auditLog.organizationId,
        action: schema.auditLog.action,
        targetType: schema.auditLog.targetType,
        targetId: schema.auditLog.targetId,
        ipAddress: schema.auditLog.ipAddress,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, userId));
    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        locale: user.locale,
        createdAt: user.createdAt,
      },
      memberships,
      signInMethods: accounts,
      sessions,
      activity,
    };
  }

  /** Organizations the user owns alone while other members remain (must transfer first). */
  private async blockingOrganizations(userId: string) {
    const owned = await this.db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(and(eq(schema.member.userId, userId), eq(schema.member.role, 'owner')));
    const blocking: string[] = [];
    const soloOrgs: string[] = [];
    for (const { organizationId } of owned) {
      const others = await this.db
        .select({ role: schema.member.role })
        .from(schema.member)
        .where(
          and(eq(schema.member.organizationId, organizationId), ne(schema.member.userId, userId)),
        );
      if (!others.length) soloOrgs.push(organizationId);
      else if (!others.some((o) => o.role === 'owner')) blocking.push(organizationId);
    }
    return { blocking, soloOrgs };
  }

  /** Deletes the account; organizations where the user is the only member go with it. */
  async deleteUser(user: { id: string; email: string }, confirmEmail: string) {
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase())
      throw new AppError('VALIDATION_FAILED', 'Type your email address to confirm');
    const { blocking, soloOrgs } = await this.blockingOrganizations(user.id);
    if (blocking.length)
      throw new AppError('CONFLICT', 'Transfer ownership of your organizations first', {
        organizations: blocking,
      });
    for (const orgId of soloOrgs) await this.purgeOrganization(orgId);
    // Sessions, accounts and memberships cascade with the user row.
    await this.db.delete(schema.user).where(eq(schema.user.id, user.id));
  }

  async exportOrganization(organizationId: string) {
    const [org] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId));
    if (!org) throw new AppError('NOT_FOUND', 'Organization not found');
    // Raw rows of org-scoped tables (fixed names, escaped as identifiers).
    const byOrg = async (table: string) =>
      (
        await this.db.execute<Record<string, unknown>>(
          sql`select * from ${sql.identifier(table)} where organization_id = ${organizationId}`,
        )
      ).rows;
    const projects = await this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    const projectIds = projects.map((p) => p.id);
    const [members, gsc, apiKeys] = await Promise.all([
      this.db
        .select({
          name: schema.user.name,
          email: schema.user.email,
          role: schema.member.role,
          joinedAt: schema.member.createdAt,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, organizationId)),
      byOrg('gsc_connections'),
      byOrg('api_keys'),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      organization: { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt },
      members,
      subscription: await byOrg('subscriptions'),
      creditLedger: await byOrg('credit_ledger'),
      projects,
      competitors: await byOrg('project_competitors'),
      keywordLists: await byOrg('keyword_lists'),
      keywordListItems: await byOrg('keyword_list_items'),
      trackedKeywords: await byOrg('tracked_keywords'),
      rankAlerts: await byOrg('rank_alerts'),
      rankAlertEvents: await byOrg('rank_alert_events'),
      rankHistory: await exportRankHistory(this.ch, projectIds),
      contentBriefs: await byOrg('content_briefs'),
      disavow: await byOrg('disavow_entries'),
      searchConsole: gsc.map((g) => stripSecrets(g, ['refresh_token_enc'])),
      apiKeys: apiKeys.map((k) => stripSecrets(k, ['key_hash'])),
      jobs: await byOrg('jobs'),
      auditLog: await byOrg('audit_log'),
    };
  }

  /** Removes an organization and every piece of its data (Postgres cascades + ClickHouse). */
  private async purgeOrganization(organizationId: string) {
    const projects = await this.db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    await deleteProjectAnalytics(
      this.ch,
      projects.map((p) => p.id),
    );
    // Sessions pointing at the org as active must not keep a dangling id.
    await this.db
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(eq(schema.session.activeOrganizationId, organizationId));
    await this.db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
  }

  async deleteOrganization(actor: { organizationId: string; userId: string }, confirmName: string) {
    const [org] = await this.db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, actor.organizationId));
    if (!org) throw new AppError('NOT_FOUND', 'Organization not found');
    if (confirmName.trim() !== org.name)
      throw new AppError('VALIDATION_FAILED', 'Type the organization name to confirm');
    await this.purgeOrganization(actor.organizationId);
    // The audit row of the deletion itself has no organization any more.
    await this.audit.log({
      organizationId: null,
      actorUserId: actor.userId,
      action: 'organization.deleted',
      targetType: 'organization',
      targetId: actor.organizationId,
    });
  }

  /** Users whose only organizations would remain ownerless (used by the UI before deletion). */
  async deletionCheck(userId: string) {
    const { blocking, soloOrgs } = await this.blockingOrganizations(userId);
    const names = (ids: string[]) =>
      ids.length
        ? this.db
            .select({ id: schema.organization.id, name: schema.organization.name })
            .from(schema.organization)
            .where(inArray(schema.organization.id, ids))
        : Promise.resolve([]);
    return { mustTransfer: await names(blocking), deletedWithAccount: await names(soloOrgs) };
  }
}
