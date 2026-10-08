'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddDisavowInput,
  AnchorRowDto,
  Backlink,
  BacklinkOverview,
  DisavowEntryDto,
  LinkGapResponse,
  Paginated,
  ReferringDomain,
  ToxicityDto,
  ToxicResponse,
} from '@seo/shared';
import { api } from './api';
import { qk } from './queries';

type Params = Record<string, string | undefined>;

const qs = (params: Params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, v);
  return p.toString();
};

export const bk = {
  research: (kind: string, p: Params) => ['backlinks', kind, p] as const,
  toxic: (projectId: string, p: Params) =>
    ['projects', projectId, 'backlinks', 'toxic', p] as const,
  disavow: (projectId: string) => ['projects', projectId, 'disavow'] as const,
  project: (projectId: string) => ['projects', projectId, 'backlinks'] as const,
};

type Charged = { creditsCharged: number };

/** GET that refreshes the header credit balance when the call spent credits. */
function useResearch<T extends Charged>(key: readonly unknown[], path: string, enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await api<T>(path);
      if (res.creditsCharged > 0) void qc.invalidateQueries({ queryKey: qk.me });
      return res;
    },
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export const useBacklinkOverview = (p: Params) =>
  useResearch<BacklinkOverview>(
    bk.research('overview', p),
    `/backlinks/overview?${qs(p)}`,
    !!p.target,
  );

export const useBacklinkList = (p: Params) =>
  useResearch<Paginated<Backlink> & Charged>(
    bk.research('list', p),
    `/backlinks/list?${qs(p)}`,
    !!p.target,
  );

export const useReferringDomains = (p: Params) =>
  useResearch<Paginated<ReferringDomain & { toxicity: ToxicityDto }> & Charged>(
    bk.research('domains', p),
    `/backlinks/referring-domains?${qs(p)}`,
    !!p.target,
  );

export const useAnchors = (p: Params) =>
  useResearch<Paginated<AnchorRowDto> & Charged>(
    bk.research('anchors', p),
    `/backlinks/anchors?${qs(p)}`,
    !!p.target,
  );

export const useLinkGap = (p: Params) =>
  useResearch<LinkGapResponse>(
    bk.research('link-gap', p),
    `/backlinks/link-gap?${qs(p)}`,
    !!p.target && !!p.competitors,
  );

export const useToxic = (projectId: string | undefined, p: Params) =>
  useResearch<ToxicResponse>(
    bk.toxic(projectId ?? '', p),
    `/projects/${projectId}/backlinks/toxic?${qs(p)}`,
    !!projectId,
  );

export function useDisavow(projectId: string | undefined) {
  return useQuery({
    queryKey: bk.disavow(projectId ?? ''),
    queryFn: () => api<DisavowEntryDto[]>(`/projects/${projectId}/disavow`),
    enabled: !!projectId,
  });
}

function useInvalidateProject(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: bk.disavow(projectId) });
    void qc.invalidateQueries({ queryKey: bk.project(projectId) });
  };
}

export function useAddDisavow(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (input: AddDisavowInput) =>
      api<{ added: number; skipped: number }>(`/projects/${projectId}/disavow`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useRemoveDisavow(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<{ removed: number }>(`/projects/${projectId}/disavow/remove`, {
        method: 'POST',
        body: { ids },
      }),
    onSuccess: invalidate,
  });
}

export const disavowExportUrl = (projectId: string) =>
  `/api/v1/projects/${projectId}/disavow/export`;
