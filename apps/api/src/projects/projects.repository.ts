import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, schema, type Database } from '@seo/db';
import type { Competitor, Project } from '@seo/shared';
import { DB } from '../infra/tokens.js';

type ProjectRow = typeof schema.projects.$inferSelect;
type CompetitorRow = typeof schema.projectCompetitors.$inferSelect;

export const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  organizationId: r.organizationId,
  name: r.name,
  domain: r.domain,
  locationCode: r.locationCode,
  languageCode: r.languageCode,
  device: r.device,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const toCompetitor = (r: CompetitorRow): Competitor => ({
  id: r.id,
  projectId: r.projectId,
  domain: r.domain,
  source: r.source,
  createdAt: r.createdAt.toISOString(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every method takes `organizationId` and filters by it: this is the per-query
 * tenant isolation guarantee (covered by integration tests).
 */
@Injectable()
export class ProjectsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  private live(organizationId: string) {
    return and(
      eq(schema.projects.organizationId, organizationId),
      isNull(schema.projects.deletedAt),
    );
  }

  async list(organizationId: string): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(schema.projects)
      .where(this.live(organizationId))
      .orderBy(asc(schema.projects.createdAt));
    return rows.map(toProject);
  }

  async count(organizationId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(schema.projects)
      .where(this.live(organizationId));
    return row?.n ?? 0;
  }

  async find(organizationId: string, id: string): Promise<Project | null> {
    if (!UUID_RE.test(id)) return null;
    const [row] = await this.db
      .select()
      .from(schema.projects)
      .where(and(this.live(organizationId), eq(schema.projects.id, id)));
    return row ? toProject(row) : null;
  }

  async create(
    organizationId: string,
    createdBy: string,
    data: Pick<Project, 'name' | 'domain' | 'locationCode' | 'languageCode' | 'device'>,
  ): Promise<Project> {
    const [row] = await this.db
      .insert(schema.projects)
      .values({ ...data, organizationId, createdBy })
      .returning();
    return toProject(row!);
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Pick<Project, 'name' | 'domain' | 'locationCode' | 'languageCode' | 'device'>>,
  ): Promise<Project | null> {
    if (!UUID_RE.test(id)) return null;
    const [row] = await this.db
      .update(schema.projects)
      .set(data)
      .where(and(this.live(organizationId), eq(schema.projects.id, id)))
      .returning();
    return row ? toProject(row) : null;
  }

  async softDelete(organizationId: string, id: string): Promise<boolean> {
    if (!UUID_RE.test(id)) return false;
    const rows = await this.db
      .update(schema.projects)
      .set({ deletedAt: new Date() })
      .where(and(this.live(organizationId), eq(schema.projects.id, id)))
      .returning({ id: schema.projects.id });
    return rows.length > 0;
  }

  async listCompetitors(organizationId: string, projectId: string): Promise<Competitor[]> {
    const rows = await this.db
      .select()
      .from(schema.projectCompetitors)
      .where(
        and(
          eq(schema.projectCompetitors.organizationId, organizationId),
          eq(schema.projectCompetitors.projectId, projectId),
        ),
      )
      .orderBy(asc(schema.projectCompetitors.createdAt));
    return rows.map(toCompetitor);
  }

  async addCompetitor(
    organizationId: string,
    projectId: string,
    domain: string,
    source: 'manual' | 'auto',
  ): Promise<Competitor | null> {
    const [row] = await this.db
      .insert(schema.projectCompetitors)
      .values({ organizationId, projectId, domain, source })
      .onConflictDoNothing()
      .returning();
    return row ? toCompetitor(row) : null;
  }

  async removeCompetitor(
    organizationId: string,
    projectId: string,
    competitorId: string,
  ): Promise<boolean> {
    if (!UUID_RE.test(competitorId)) return false;
    const rows = await this.db
      .delete(schema.projectCompetitors)
      .where(
        and(
          eq(schema.projectCompetitors.organizationId, organizationId),
          eq(schema.projectCompetitors.projectId, projectId),
          eq(schema.projectCompetitors.id, competitorId),
        ),
      )
      .returning({ id: schema.projectCompetitors.id });
    return rows.length > 0;
  }
}
