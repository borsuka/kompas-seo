import type { JobType } from '@seo/shared';
import type { Processor } from '../runtime.js';
import { monthlyGrant } from './credits.js';
import { buildBrief } from './content.js';
import { scheduleGsc, syncGsc } from './gsc.js';
import { clusterList } from './keywords.js';
import { checkRankings, scheduleRankChecks } from './rankings.js';
import { demoProgress } from './system.js';

/** One processor per job type. Adding a job type without a processor fails typechecking. */
export const PROCESSORS: Record<JobType, Processor<never>> = {
  'system.demo-progress': demoProgress,
  'credits.monthly-grant': monthlyGrant,
  'keywords.cluster': clusterList,
  'rankings.schedule': scheduleRankChecks,
  'rankings.check': checkRankings,
  'content.brief': buildBrief,
  'gsc.sync': syncGsc,
  'gsc.schedule': scheduleGsc,
};
