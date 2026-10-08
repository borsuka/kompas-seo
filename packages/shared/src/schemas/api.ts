import { z } from 'zod';
import { domainSchema } from '../domain.js';
import { deviceSchema, languageCodeSchema, locationCodeSchema } from '../locale.js';
import { invitableRoleSchema, roleSchema } from '../permissions.js';
import { planIdSchema } from '../plans.js';
import { creditReasonSchema } from '../credits.js';
import { jobStatusSchema, jobTypeSchema } from '../queues.js';

/** Request/response contracts of the REST API, shared by api (validation) and web (typing). */

export const uuidSchema = z.uuid();
export const idParamSchema = z.object({ id: z.string().min(1).max(64) });

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// --- Projects -------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  domain: domainSchema,
  locationCode: locationCodeSchema.default(2100),
  languageCode: languageCodeSchema.default('bg'),
  device: deviceSchema.default('desktop'),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export const projectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  domain: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  device: deviceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const competitorSourceSchema = z.enum(['manual', 'auto']);

export const addCompetitorSchema = z.object({
  domain: domainSchema,
  /** `auto` when accepted from competitor discovery. */
  source: z.enum(['manual', 'auto']).default('manual'),
});
export type AddCompetitorInput = z.input<typeof addCompetitorSchema>;

export const competitorSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  domain: z.string(),
  source: competitorSourceSchema,
  createdAt: z.string(),
});
export type Competitor = z.infer<typeof competitorSchema>;

// --- Organization & members ----------------------------------------------------------

export const memberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: roleSchema,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  createdAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const inviteMemberSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: invitableRoleSchema,
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({ role: invitableRoleSchema });

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
  status: z.string(),
  expiresAt: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** Returned by GET /me: everything the UI shell needs in one call. */
export const meSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    emailVerified: z.boolean(),
  }),
  organizations: z.array(
    z.object({ id: z.string(), name: z.string(), slug: z.string(), role: roleSchema }),
  ),
  activeOrganization: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      role: roleSchema,
      plan: planIdSchema,
      creditBalance: z.number().int(),
    })
    .nullable(),
});
export type Me = z.infer<typeof meSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// --- Credits ---------------------------------------------------------------------

export const creditLedgerEntrySchema = z.object({
  id: z.string(),
  delta: z.number().int(),
  balanceAfter: z.number().int(),
  reason: creditReasonSchema,
  description: z.string().nullable(),
  createdAt: z.string(),
});
export type CreditLedgerEntry = z.infer<typeof creditLedgerEntrySchema>;

export const creditsOverviewSchema = z.object({
  balance: z.number().int(),
  plan: planIdSchema,
  monthlyCredits: z.number().int(),
});
export type CreditsOverview = z.infer<typeof creditsOverviewSchema>;

// --- Jobs --------------------------------------------------------------------------

export const jobSchema = z.object({
  id: z.string(),
  type: jobTypeSchema,
  status: jobStatusSchema,
  progress: z.number(),
  message: z.string().nullable(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

export const createDemoJobSchema = z.object({
  steps: z.number().int().min(1).max(50).default(10),
  delayMs: z.number().int().min(10).max(5000).default(300),
});
