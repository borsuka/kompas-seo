import { z } from 'zod';

export const PLAN_IDS = ['free', 'pro', 'agency'] as const;
export const planIdSchema = z.enum(PLAN_IDS);
export type PlanId = z.infer<typeof planIdSchema>;

export interface PlanLimits {
  /** Credits granted at the start of every billing period. Unused credits do not roll over. */
  monthlyCredits: number;
  maxProjects: number;
  maxMembers: number;
  maxTrackedKeywords: number;
  apiAccess: boolean;
  /** Public API requests per minute per API key (0 = no API). */
  apiRatePerMinute: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    monthlyCredits: 500,
    maxProjects: 1,
    maxMembers: 2,
    maxTrackedKeywords: 50,
    apiAccess: false,
    apiRatePerMinute: 0,
  },
  pro: {
    monthlyCredits: 10_000,
    maxProjects: 5,
    maxMembers: 5,
    maxTrackedKeywords: 750,
    apiAccess: false,
    apiRatePerMinute: 0,
  },
  agency: {
    monthlyCredits: 50_000,
    maxProjects: 25,
    maxMembers: 25,
    maxTrackedKeywords: 5_000,
    apiAccess: true,
    apiRatePerMinute: 120,
  },
};

export const DEFAULT_PLAN: PlanId = 'free';
