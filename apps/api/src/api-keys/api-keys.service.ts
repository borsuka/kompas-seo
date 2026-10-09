import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getOrganizationPlan, isNull, schema, type Database } from '@seo/db';
import {
  API_KEY_PREFIX,
  AppError,
  PLANS,
  type ApiKey,
  type CreatedApiKey,
  type Role,
} from '@seo/shared';
import type { z } from 'zod';
import type { createApiKeySchema } from '@seo/shared';
import { AuditService } from '../audit/audit.service.js';
import { hashApiKey } from '../auth/guards.js';
import { DB } from '../infra/tokens.js';

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<ApiKey[]> {
    const rows = await this.db
      .select({ key: schema.apiKeys, user: { id: schema.user.id, name: schema.user.name } })
      .from(schema.apiKeys)
      .innerJoin(schema.user, eq(schema.user.id, schema.apiKeys.createdBy))
      .where(
        and(eq(schema.apiKeys.organizationId, organizationId), isNull(schema.apiKeys.revokedAt)),
      )
      .orderBy(desc(schema.apiKeys.createdAt));
    return rows.map(({ key, user }) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      role: key.role === 'member' ? 'member' : 'viewer',
      createdBy: user,
      createdAt: key.createdAt.toISOString(),
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async create(
    actor: { organizationId: string; userId: string; role: Role; ip: string | null },
    input: z.output<typeof createApiKeySchema>,
  ): Promise<CreatedApiKey> {
    const plan = await getOrganizationPlan(this.db, actor.organizationId);
    if (!PLANS[plan].apiAccess)
      throw new AppError('PLAN_LIMIT_REACHED', 'Your plan does not include API access', {
        resource: 'apiAccess',
      });
    // A key can never do more than the person who created it.
    if (RANK[input.role] > RANK[actor.role])
      throw new AppError(
        'FORBIDDEN',
        'You cannot create a key with more rights than your own role',
      );
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const [row] = await this.db
      .insert(schema.apiKeys)
      .values({
        organizationId: actor.organizationId,
        name: input.name,
        prefix: key.slice(0, 10),
        keyHash: hashApiKey(key),
        role: input.role,
        createdBy: actor.userId,
      })
      .returning();
    const [user] = await this.db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, actor.userId));
    await this.audit.log({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: row!.id,
      metadata: { name: input.name, role: input.role },
      ipAddress: actor.ip,
    });
    return {
      id: row!.id,
      name: row!.name,
      prefix: row!.prefix,
      role: input.role,
      createdBy: user!,
      createdAt: row!.createdAt.toISOString(),
      lastUsedAt: null,
      key,
    };
  }

  async revoke(actor: { organizationId: string; userId: string; ip: string | null }, id: string) {
    const [row] = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.db
          .update(schema.apiKeys)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.apiKeys.id, id),
              eq(schema.apiKeys.organizationId, actor.organizationId),
              isNull(schema.apiKeys.revokedAt),
            ),
          )
          .returning({ id: schema.apiKeys.id })
      : [];
    if (!row) throw new AppError('NOT_FOUND', 'API key not found');
    await this.audit.log({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: 'api_key.revoked',
      targetType: 'api_key',
      targetId: id,
      ipAddress: actor.ip,
    });
  }
}
