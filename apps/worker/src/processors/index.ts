import type { JobType } from '@seo/shared';
import type { Processor } from '../runtime.js';
import { monthlyGrant } from './credits.js';
import { clusterList } from './keywords.js';
import { demoProgress } from './system.js';

/** One processor per job type. Adding a job type without a processor fails typechecking. */
export const PROCESSORS: Record<JobType, Processor<never>> = {
  'system.demo-progress': demoProgress,
  'credits.monthly-grant': monthlyGrant,
  'keywords.cluster': clusterList,
};
