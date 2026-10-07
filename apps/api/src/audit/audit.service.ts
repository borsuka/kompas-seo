import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { schema, type Database } from '@seo/db';
import { DB } from '../infra/tokens.js';

export interface AuditEntry {
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Best effort: an audit failure must never break the user's action. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(schema.auditLog).values({
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ?? null,
        ipAddress: entry.ipAddress ?? null,
      });
    } catch (err) {
      this.logger.error({ err, action: entry.action }, 'Failed to write audit log');
    }
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
