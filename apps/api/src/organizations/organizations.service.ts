import { Inject, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import {
  and,
  asc,
  count,
  eq,
  getCreditBalance,
  getOrganizationPlan,
  gt,
  schema,
  type Database,
} from '@seo/db';
import {
  AppError,
  canAssignRole,
  PLANS,
  roleSchema,
  type Invitation,
  type Me,
  type Member,
  type Role,
} from '@seo/shared';
import { AuditService } from '../audit/audit.service.js';
import { authCall } from '../auth/auth-call.js';
import type { Auth } from '../auth/auth.js';
import type { AuthSession, AuthUser, OrgContext } from '../common/request-context.js';
import { AUTH, DB } from '../infra/tokens.js';

function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9а-я]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org';
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

const toRole = (r: string): Role => roleSchema.catch('viewer').parse(r);

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async me(user: AuthUser, session: AuthSession): Promise<Me> {
    const memberships = await this.db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, user.id))
      .orderBy(asc(schema.member.createdAt));

    const organizations = memberships.map((m) => ({ ...m, role: toRole(m.role) }));
    const active = organizations.find((o) => o.id === session.activeOrganizationId) ?? null;

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image ?? null,
        emailVerified: user.emailVerified,
      },
      organizations,
      activeOrganization: active
        ? {
            ...active,
            plan: await getOrganizationPlan(this.db, active.id),
            creditBalance: await getCreditBalance(this.db, active.id),
          }
        : null,
    };
  }

  async create(user: AuthUser, headers: IncomingHttpHeaders, name: string) {
    const org = await authCall(() =>
      this.auth.api.createOrganization({
        body: { name, slug: slugify(name), keepCurrentActiveOrganization: false },
        headers: fromNodeHeaders(headers),
      }),
    );
    if (!org) throw new AppError('INTERNAL', 'Organization was not created');
    await this.audit.log({
      organizationId: org.id,
      actorUserId: user.id,
      action: 'organization.created',
      targetType: 'organization',
      targetId: org.id,
    });
    return { id: org.id, name: org.name, slug: org.slug };
  }

  async activate(user: AuthUser, headers: IncomingHttpHeaders, organizationId: string) {
    const [membership] = await this.db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, user.id)),
      );
    if (!membership) throw new AppError('NOT_FOUND', 'Organization not found');
    await authCall(() =>
      this.auth.api.setActiveOrganization({
        body: { organizationId },
        headers: fromNodeHeaders(headers),
      }),
    );
  }

  async members(organizationId: string): Promise<Member[]> {
    const rows = await this.db
      .select({
        id: schema.member.id,
        userId: schema.member.userId,
        role: schema.member.role,
        createdAt: schema.member.createdAt,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, organizationId))
      .orderBy(asc(schema.member.createdAt));
    return rows.map((r) => ({ ...r, role: toRole(r.role), createdAt: r.createdAt.toISOString() }));
  }

  async invitations(organizationId: string): Promise<Invitation[]> {
    const rows = await this.db
      .select()
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, organizationId),
          eq(schema.invitation.status, 'pending'),
          gt(schema.invitation.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(schema.invitation.createdAt));
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: toRole(r.role ?? 'member'),
      status: r.status,
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  async invite(
    org: OrgContext,
    user: AuthUser,
    headers: IncomingHttpHeaders,
    email: string,
    role: Role,
  ) {
    if (!canAssignRole(org.role, role))
      throw new AppError('FORBIDDEN', 'You cannot assign this role');
    const plan = await getOrganizationPlan(this.db, org.id);
    const limit = PLANS[plan].maxMembers;
    const [members] = await this.db
      .select({ n: count() })
      .from(schema.member)
      .where(eq(schema.member.organizationId, org.id));
    const pending = (await this.invitations(org.id)).filter((i) => i.email !== email).length;
    if ((members?.n ?? 0) + pending >= limit) {
      throw new AppError('PLAN_LIMIT_REACHED', `Your plan allows up to ${limit} members`, {
        limit,
        resource: 'members',
      });
    }

    const invitation = await authCall(() =>
      this.auth.api.createInvitation({
        body: { email, role: role as 'member', organizationId: org.id, resend: true },
        headers: fromNodeHeaders(headers),
      }),
    );
    await this.audit.log({
      organizationId: org.id,
      actorUserId: user.id,
      action: 'member.invited',
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: { email, role },
    });
    return {
      id: invitation.id,
      email: invitation.email,
      role,
      status: invitation.status,
      expiresAt: new Date(invitation.expiresAt).toISOString(),
    } satisfies Invitation;
  }

  async cancelInvitation(
    org: OrgContext,
    user: AuthUser,
    headers: IncomingHttpHeaders,
    invitationId: string,
  ) {
    const [inv] = await this.db
      .select({ id: schema.invitation.id })
      .from(schema.invitation)
      .where(
        and(eq(schema.invitation.id, invitationId), eq(schema.invitation.organizationId, org.id)),
      );
    if (!inv) throw new AppError('NOT_FOUND', 'Invitation not found');
    await authCall(() =>
      this.auth.api.cancelInvitation({ body: { invitationId }, headers: fromNodeHeaders(headers) }),
    );
    await this.audit.log({
      organizationId: org.id,
      actorUserId: user.id,
      action: 'member.invitation_cancelled',
      targetType: 'invitation',
      targetId: invitationId,
    });
  }

  private async findMember(organizationId: string, memberId: string) {
    const [m] = await this.db
      .select({ id: schema.member.id, role: schema.member.role, userId: schema.member.userId })
      .from(schema.member)
      .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, organizationId)));
    if (!m) throw new AppError('NOT_FOUND', 'Member not found');
    return { ...m, role: toRole(m.role) };
  }

  async updateRole(
    org: OrgContext,
    user: AuthUser,
    headers: IncomingHttpHeaders,
    memberId: string,
    role: Role,
  ) {
    const target = await this.findMember(org.id, memberId);
    if (target.role === 'owner' && org.role !== 'owner') {
      throw new AppError('FORBIDDEN', 'Only owners can change an owner');
    }
    if (!canAssignRole(org.role, role))
      throw new AppError('FORBIDDEN', 'You cannot assign this role');
    if (target.userId === user.id)
      throw new AppError('FORBIDDEN', 'You cannot change your own role');

    await authCall(() =>
      this.auth.api.updateMemberRole({
        body: { memberId, role: role as 'member', organizationId: org.id },
        headers: fromNodeHeaders(headers),
      }),
    );
    await this.audit.log({
      organizationId: org.id,
      actorUserId: user.id,
      action: 'member.role_changed',
      targetType: 'member',
      targetId: memberId,
      metadata: { from: target.role, to: role },
    });
  }

  async removeMember(
    org: OrgContext,
    user: AuthUser,
    headers: IncomingHttpHeaders,
    memberId: string,
  ) {
    const target = await this.findMember(org.id, memberId);
    if (target.role === 'owner') throw new AppError('FORBIDDEN', 'Owners cannot be removed');
    await authCall(() =>
      this.auth.api.removeMember({
        body: { memberIdOrEmail: memberId, organizationId: org.id },
        headers: fromNodeHeaders(headers),
      }),
    );
    await this.audit.log({
      organizationId: org.id,
      actorUserId: user.id,
      action: 'member.removed',
      targetType: 'member',
      targetId: memberId,
    });
  }

  async getInvitation(headers: IncomingHttpHeaders, invitationId: string) {
    const inv = await authCall(() =>
      this.auth.api.getInvitation({
        query: { id: invitationId },
        headers: fromNodeHeaders(headers),
      }),
    );
    return {
      id: inv.id,
      email: inv.email,
      role: toRole(inv.role ?? 'member'),
      status: inv.status,
      expiresAt: new Date(inv.expiresAt).toISOString(),
      organizationName: inv.organizationName,
      inviterEmail: inv.inviterEmail,
    };
  }

  async acceptInvitation(user: AuthUser, headers: IncomingHttpHeaders, invitationId: string) {
    const result = await authCall(() =>
      this.auth.api.acceptInvitation({ body: { invitationId }, headers: fromNodeHeaders(headers) }),
    );
    const organizationId = result?.invitation.organizationId;
    if (organizationId) {
      await this.audit.log({
        organizationId,
        actorUserId: user.id,
        action: 'member.joined',
        targetType: 'invitation',
        targetId: invitationId,
      });
    }
    return { organizationId };
  }
}
