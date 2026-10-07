import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access';

/**
 * Better Auth guards its own organization endpoints (invite, change role, delete org)
 * with these roles. Application resources are guarded by `@seo/shared#can` in our
 * PermissionGuard; the two must agree: only owner/admin manage members & invitations.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements }),
  admin: ac.newRole({ ...adminAc.statements }),
  member: ac.newRole({ ...memberAc.statements }),
  viewer: ac.newRole({ organization: [], member: [], invitation: [] }),
};
