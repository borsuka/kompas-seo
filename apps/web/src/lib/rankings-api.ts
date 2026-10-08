'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateRankAlertInput,
  Device,
  Job,
  KeywordHistory,
  RankAlert,
  RankAlertEvent,
  RankingsResponse,
  RankingsSummary,
} from '@seo/shared';
import { api } from './api';
import { qk } from './queries';

type Params = Record<string, string | undefined>;

const qs = (params: Params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, v);
  return p.toString();
};

export const rk = {
  all: (projectId: string) => ['projects', projectId, 'rankings'] as const,
  list: (projectId: string, p: Params) => ['projects', projectId, 'rankings', 'list', p] as const,
  summary: (projectId: string, p: Params) =>
    ['projects', projectId, 'rankings', 'summary', p] as const,
  history: (projectId: string, id: string, days: number) =>
    ['projects', projectId, 'rankings', 'history', id, days] as const,
  alerts: (projectId: string) => ['projects', projectId, 'rankings', 'alerts'] as const,
  events: (projectId: string) => ['projects', projectId, 'rankings', 'events'] as const,
};

const base = (projectId: string) => `/projects/${projectId}/rankings`;

export function useRankings(projectId: string | undefined, p: Params) {
  return useQuery({
    queryKey: rk.list(projectId ?? '', p),
    queryFn: () => api<RankingsResponse>(`${base(projectId!)}?${qs(p)}`),
    enabled: !!projectId,
    placeholderData: keepPreviousData,
  });
}

export function useRankingsSummary(projectId: string | undefined, p: Params) {
  return useQuery({
    queryKey: rk.summary(projectId ?? '', p),
    queryFn: () => api<RankingsSummary>(`${base(projectId!)}/summary?${qs(p)}`),
    enabled: !!projectId,
    placeholderData: keepPreviousData,
  });
}

export function useKeywordHistory(projectId: string, id: string | null, days = 90) {
  return useQuery({
    queryKey: rk.history(projectId, id ?? '', days),
    queryFn: () => api<KeywordHistory>(`${base(projectId)}/keywords/${id}/history?days=${days}`),
    enabled: !!id,
  });
}

/** Invalidates rankings and the credit balance (adding/checking spends credits). */
function useRefresh(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: rk.all(projectId) });
    void qc.invalidateQueries({ queryKey: qk.me });
  };
}

export function useAddTracked(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (input: { keywords: string[]; devices: Device[]; tags: string[] }) =>
      api<{ added: number; skipped: number; creditsCharged: number; job: Job | null }>(
        `${base(projectId)}/keywords`,
        { method: 'POST', body: input },
      ),
    onSuccess: refresh,
  });
}

export function useRemoveTracked(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<{ removed: number }>(`${base(projectId)}/keywords/remove`, {
        method: 'POST',
        body: { ids },
      }),
    onSuccess: refresh,
  });
}

export function useUpdateTrackedTags(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) =>
      api<void>(`${base(projectId)}/keywords/${id}`, { method: 'PATCH', body: { tags } }),
    onSuccess: refresh,
  });
}

export function useCheckRankings(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Job>(`${base(projectId)}/check`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.me }),
  });
}

export function useRankAlerts(projectId: string | undefined) {
  return useQuery({
    queryKey: rk.alerts(projectId ?? ''),
    queryFn: () => api<RankAlert[]>(`${base(projectId!)}/alerts`),
    enabled: !!projectId,
  });
}

export function useRankAlertEvents(projectId: string | undefined) {
  return useQuery({
    queryKey: rk.events(projectId ?? ''),
    queryFn: () => api<RankAlertEvent[]>(`${base(projectId!)}/alert-events`),
    enabled: !!projectId,
  });
}

export function useSaveAlert(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CreateRankAlertInput> & { id?: string }) =>
      id
        ? api<RankAlert>(`${base(projectId)}/alerts/${id}`, { method: 'PATCH', body: input })
        : api<RankAlert>(`${base(projectId)}/alerts`, { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rk.alerts(projectId) }),
  });
}

export function useDeleteAlert(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`${base(projectId)}/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rk.alerts(projectId) }),
  });
}
