import { describe, expect, it } from 'vitest';
import { can, canAssignRole, ROLES, STATEMENTS, type Permission } from './permissions.js';

const everyPermission = Object.entries(STATEMENTS).flatMap(([resource, actions]) =>
  actions.map((action) => ({ permission: `${resource}:${action}` as Permission, action })),
);

describe('permissions', () => {
  it('owner can do everything', () => {
    for (const { permission } of everyPermission) expect(can('owner', permission)).toBe(true);
  });

  it('viewer is strictly read-only', () => {
    for (const { permission, action } of everyPermission) {
      expect(can('viewer', permission)).toBe(action === 'read');
    }
  });

  it('member cannot manage members, billing or delete projects', () => {
    expect(can('member', 'project:update')).toBe(true);
    expect(can('member', 'project:delete')).toBe(false);
    expect(can('member', 'member:invite')).toBe(false);
    expect(can('member', 'billing:manage')).toBe(false);
  });

  it('admin cannot delete the organization or manage billing', () => {
    expect(can('admin', 'member:invite')).toBe(true);
    expect(can('admin', 'organization:delete')).toBe(false);
    expect(can('admin', 'billing:manage')).toBe(false);
  });

  it('no role means no access', () => {
    expect(can(null, 'project:read')).toBe(false);
  });

  it('only owners can assign the owner role', () => {
    expect(canAssignRole('owner', 'owner')).toBe(true);
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'viewer')).toBe(true);
    expect(canAssignRole('member', 'viewer')).toBe(false);
    expect(ROLES).toHaveLength(4);
  });
});
