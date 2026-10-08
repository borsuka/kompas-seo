import { Inject, Injectable } from '@nestjs/common';
import { getOrganizationPlan, type Database } from '@seo/db';
import { AppError, createProjectSchema, PLANS, type Competitor, type Project } from '@seo/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DB } from '../infra/tokens.js';
import { ProjectsRepository } from './projects.repository.js';

export const MAX_COMPETITORS_PER_PROJECT = 10;

type CreateProject = z.output<typeof createProjectSchema>;
type UpdateProject = Partial<CreateProject>;

interface Actor {
  organizationId: string;
  userId: string;
  ip?: string | null;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  list(organizationId: string) {
    return this.repo.list(organizationId);
  }

  async get(organizationId: string, id: string): Promise<Project> {
    const project = await this.repo.find(organizationId, id);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found');
    return project;
  }

  async create(actor: Actor, input: CreateProject): Promise<Project> {
    const plan = await getOrganizationPlan(this.db, actor.organizationId);
    const limit = PLANS[plan].maxProjects;
    if ((await this.repo.count(actor.organizationId)) >= limit) {
      throw new AppError('PLAN_LIMIT_REACHED', `Your plan allows up to ${limit} projects`, {
        limit,
        resource: 'projects',
      });
    }
    try {
      const project = await this.repo.create(actor.organizationId, actor.userId, input);
      await this.audit.log({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: 'project.created',
        targetType: 'project',
        targetId: project.id,
        metadata: { domain: project.domain },
        ipAddress: actor.ip,
      });
      return project;
    } catch (err) {
      throw this.mapUniqueViolation(err);
    }
  }

  async update(actor: Actor, id: string, input: UpdateProject): Promise<Project> {
    try {
      const project = await this.repo.update(actor.organizationId, id, input);
      if (!project) throw new AppError('NOT_FOUND', 'Project not found');
      await this.audit.log({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: 'project.updated',
        targetType: 'project',
        targetId: id,
        metadata: { fields: Object.keys(input) },
        ipAddress: actor.ip,
      });
      return project;
    } catch (err) {
      throw this.mapUniqueViolation(err);
    }
  }

  async remove(actor: Actor, id: string): Promise<void> {
    if (!(await this.repo.softDelete(actor.organizationId, id))) {
      throw new AppError('NOT_FOUND', 'Project not found');
    }
    await this.audit.log({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: 'project.deleted',
      targetType: 'project',
      targetId: id,
      ipAddress: actor.ip,
    });
  }

  async competitors(organizationId: string, projectId: string): Promise<Competitor[]> {
    await this.get(organizationId, projectId);
    return this.repo.listCompetitors(organizationId, projectId);
  }

  async addCompetitor(
    actor: Actor,
    projectId: string,
    domain: string,
    source: 'manual' | 'auto' = 'manual',
  ): Promise<Competitor> {
    const project = await this.get(actor.organizationId, projectId);
    if (domain === project.domain) {
      throw new AppError('VALIDATION_FAILED', 'A project cannot compete with itself');
    }
    const existing = await this.repo.listCompetitors(actor.organizationId, projectId);
    if (existing.some((c) => c.domain === domain)) {
      throw new AppError('CONFLICT', 'Competitor already added');
    }
    if (existing.length >= MAX_COMPETITORS_PER_PROJECT) {
      throw new AppError(
        'PLAN_LIMIT_REACHED',
        `Up to ${MAX_COMPETITORS_PER_PROJECT} competitors per project`,
        {
          limit: MAX_COMPETITORS_PER_PROJECT,
          resource: 'competitors',
        },
      );
    }
    const competitor = await this.repo.addCompetitor(
      actor.organizationId,
      projectId,
      domain,
      source,
    );
    if (!competitor) throw new AppError('CONFLICT', 'Competitor already added');
    await this.audit.log({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: 'project.competitor_added',
      targetType: 'project',
      targetId: projectId,
      metadata: { domain },
      ipAddress: actor.ip,
    });
    return competitor;
  }

  async removeCompetitor(actor: Actor, projectId: string, competitorId: string): Promise<void> {
    await this.get(actor.organizationId, projectId);
    if (!(await this.repo.removeCompetitor(actor.organizationId, projectId, competitorId))) {
      throw new AppError('NOT_FOUND', 'Competitor not found');
    }
  }

  private mapUniqueViolation(err: unknown): unknown {
    const code =
      (err as { code?: string; cause?: { code?: string } }).code ??
      (err as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') {
      return new AppError('CONFLICT', 'A project for this domain and location already exists');
    }
    return err;
  }
}
