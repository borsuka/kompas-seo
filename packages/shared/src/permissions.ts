import { z } from 'zod';

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Roles that can be assigned through invitations (ownership is transferred, not invited). */
export const INVITABLE_ROLES = ['admin', 'member', 'viewer'] as const satisfies readonly Role[];
export const invitableRoleSchema = z.enum(INVITABLE_ROLES);

/**
 * Application permission statements: resource -> actions.
 * The API maps these onto Better Auth's access control; the web app uses them to
 * hide controls. The API is the source of truth — the UI only mirrors it.
 */
export const STATEMENTS = {
  organization: ['read', 'update', 'delete'],
  member: ['read', 'invite', 'update', 'remove'],
  project: ['read', 'create', 'update', 'delete'],
  keywordList: ['read', 'create', 'update', 'delete'],
  job: ['read', 'create'],
  credits: ['read'],
  billing: ['read', 'manage'],
  apiKey: ['read', 'manage'],
  report: ['read', 'create'],
  /** Running research that queries data providers and spends credits. */
  research: ['run'],
} as const;

export type Resource = keyof typeof STATEMENTS;
export type Action<R extends Resource> = (typeof STATEMENTS)[R][number];
export type Permission = {
  [R in Resource]: `${R}:${Action<R>}`;
}[Resource];

type Grants = { [R in Resource]?: readonly Action<R>[] };

const all = <R extends Resource>(r: R) => STATEMENTS[r];
const readOnly: Grants = Object.fromEntries(
  (Object.keys(STATEMENTS) as Resource[])
    .filter((r) => (STATEMENTS[r] as readonly string[]).includes('read'))
    .map((r) => [r, ['read']]),
) as Grants;

export const ROLE_GRANTS: Record<Role, Grants> = {
  owner: Object.fromEntries(
    (Object.keys(STATEMENTS) as Resource[]).map((r) => [r, all(r)]),
  ) as Grants,
  admin: {
    organization: ['read', 'update'],
    member: ['read', 'invite', 'update', 'remove'],
    project: all('project'),
    keywordList: all('keywordList'),
    job: all('job'),
    credits: ['read'],
    billing: ['read'],
    apiKey: all('apiKey'),
    report: all('report'),
    research: all('research'),
  },
  member: {
    organization: ['read'],
    member: ['read'],
    project: ['read', 'create', 'update'],
    keywordList: all('keywordList'),
    job: all('job'),
    credits: ['read'],
    report: all('report'),
    research: all('research'),
  },
  viewer: readOnly,
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const [resource, action] = permission.split(':') as [Resource, string];
  const actions = ROLE_GRANTS[role][resource] as readonly string[] | undefined;
  return actions?.includes(action) ?? false;
}

/** Whether `actor` may assign `target` to someone (no one can create an owner via role change). */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === 'owner') return actor === 'owner';
  return can(actor, 'member:update');
}
