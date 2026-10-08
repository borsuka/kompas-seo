'use client';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CompetitorDiscovery,
  ContentGapResponse,
  DomainKeywordRow,
  DomainOverviewResponse,
  KeywordGapResponse,
  Paginated,
  TopPage,
} from '@seo/shared';
import { api } from './api';
import { qk } from './queries';

type Params = Record<string, string | undefined>;

const qs = (params: Params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, v);
  return p.toString();
};

export const dk = {
  overview: (p: Params) => ['domains', 'overview', p] as const,
  keywords: (p: Params) => ['domains', 'keywords', p] as const,
  pages: (p: Params) => ['domains', 'pages', p] as const,
  discover: (projectId: string) => ['projects', projectId, 'competitors', 'discover'] as const,
  gap: (p: Params) => ['domains', 'gap', p] as const,
  contentGap: (p: Params) => ['domains', 'content-gap', p] as const,
};

/** GET that refreshes the credit balance in the header when the call spent credits. */
function useResearch<T>(
  key: readonly unknown[],
  path: string,
  enabled: boolean,
  keepPrevious = false,
) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await api<T>(path);
      const charged = (res as { creditsCharged?: number }).creditsCharged ?? 0;
      if (charged > 0) void qc.invalidateQueries({ queryKey: qk.me });
      return res;
    },
    enabled,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    staleTime: 60_000,
  });
}

export function useDomainOverview(p: Params) {
  return useResearch<DomainOverviewResponse>(
    dk.overview(p),
    `/domains/overview?${qs(p)}`,
    !!p.domain,
  );
}

export function useDomainKeywords(p: Params) {
  return useResearch<Paginated<DomainKeywordRow> & { creditsCharged: number }>(
    dk.keywords(p),
    `/domains/keywords?${qs(p)}`,
    !!p.domain,
    true,
  );
}

export function useDomainPages(p: Params) {
  return useResearch<Paginated<TopPage> & { creditsCharged: number }>(
    dk.pages(p),
    `/domains/pages?${qs(p)}`,
    !!p.domain,
    true,
  );
}

export function useDiscoverCompetitors(projectId: string | undefined, enabled: boolean) {
  return useResearch<CompetitorDiscovery>(
    dk.discover(projectId ?? ''),
    `/projects/${projectId}/competitors/discover`,
    !!projectId && enabled,
  );
}

export function useKeywordGap(p: Params) {
  return useResearch<KeywordGapResponse>(
    dk.gap(p),
    `/domains/keyword-gap?${qs(p)}`,
    !!p.target && !!p.competitors,
    true,
  );
}

export function useContentGap(p: Params) {
  return useResearch<ContentGapResponse>(
    dk.contentGap(p),
    `/domains/content-gap?${qs(p)}`,
    !!p.target && !!p.competitors,
  );
}
