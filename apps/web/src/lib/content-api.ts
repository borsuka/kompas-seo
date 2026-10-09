'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Brief,
  BriefListItem,
  Calibration,
  Cannibalization,
  CreateBriefInput,
  GscConnection,
  GscPerformance,
  Paginated,
} from '@seo/shared';
import { api } from './api';
import { qk } from './queries';

type Params = Record<string, string | undefined>;

const qs = (params: Params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, v);
  return p.toString();
};

export const ck = {
  briefs: (p: Params) => ['content', 'briefs', p] as const,
  brief: (id: string) => ['content', 'brief', id] as const,
  gsc: (projectId: string) => ['projects', projectId, 'gsc'] as const,
  gscReport: (projectId: string, kind: string, p: Params) =>
    ['projects', projectId, 'gsc', kind, p] as const,
};

export function useBriefs(p: Params) {
  return useQuery({
    queryKey: ck.briefs(p),
    queryFn: () => api<Paginated<BriefListItem>>(`/content/briefs?${qs(p)}`),
    placeholderData: keepPreviousData,
  });
}

export function useBrief(id: string) {
  return useQuery({
    queryKey: ck.brief(id),
    queryFn: () => api<Brief>(`/content/briefs/${id}`),
    // Poll lightly while the job runs (SSE progress is shown separately).
    refetchInterval: (q) =>
      q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 4000 : false,
  });
}

export function useCreateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBriefInput) =>
      api<Brief>('/content/briefs', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['content', 'briefs'] });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useDeleteBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/content/briefs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content', 'briefs'] }),
  });
}

export const briefExportUrl = (id: string, ui: string) =>
  `/api/v1/content/briefs/${id}/export?ui=${ui}`;

// ------------------------------------------------------------ Search Console

export function useGsc(projectId: string | undefined) {
  return useQuery({
    queryKey: ck.gsc(projectId ?? ''),
    queryFn: () => api<GscConnection>(`/projects/${projectId}/gsc`),
    enabled: !!projectId,
  });
}

export function useGscSites(projectId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...ck.gsc(projectId ?? ''), 'sites'],
    queryFn: () =>
      api<{ siteUrl: string; permissionLevel: string }[]>(`/projects/${projectId}/gsc/sites`),
    enabled: !!projectId && enabled,
  });
}

function useGscAction<T, V = void>(projectId: string, fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.gsc(projectId) }),
  });
}

export const useGscConnect = (projectId: string) =>
  useGscAction(projectId, () =>
    api<{ url: string | null }>(`/projects/${projectId}/gsc/connect`, { method: 'POST', body: {} }),
  );
export const useGscSelectSite = (projectId: string) =>
  useGscAction(projectId, (siteUrl: string) =>
    api<GscConnection>(`/projects/${projectId}/gsc/site`, { method: 'POST', body: { siteUrl } }),
  );
export const useGscSync = (projectId: string) =>
  useGscAction(projectId, () =>
    api<{ id: string }>(`/projects/${projectId}/gsc/sync`, { method: 'POST', body: {} }),
  );
export const useGscDisconnect = (projectId: string) =>
  useGscAction(projectId, () => api<void>(`/projects/${projectId}/gsc`, { method: 'DELETE' }));

export function useGscReport<T extends GscPerformance | Cannibalization | Calibration>(
  projectId: string | undefined,
  kind: 'performance' | 'cannibalization' | 'calibration',
  p: Params,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ck.gscReport(projectId ?? '', kind, p),
    queryFn: () => api<T>(`/projects/${projectId}/gsc/${kind}?${qs(p)}`),
    enabled: !!projectId && enabled,
    placeholderData: keepPreviousData,
  });
}
