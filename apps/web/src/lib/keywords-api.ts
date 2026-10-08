'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClusterSummary,
  CreateKeywordListInput,
  ExplorerResponse,
  Job,
  KeywordList,
  KeywordListItem,
  KeywordOverview,
  Paginated,
} from '@seo/shared';
import { api } from './api';
import { qk } from './queries';

/** Search params are passed through as-is: the API validates and normalizes them. */
const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, v);
  return p.toString();
};

export const kk = {
  explore: (params: Record<string, string | undefined>) => ['keywords', 'explore', params] as const,
  overview: (params: Record<string, string | undefined>) =>
    ['keywords', 'overview', params] as const,
  lists: ['keyword-lists'] as const,
  list: (id: string) => ['keyword-lists', id] as const,
  items: (id: string, params: Record<string, string | undefined>) =>
    ['keyword-lists', id, 'items', params] as const,
  clusters: (id: string) => ['keyword-lists', id, 'clusters'] as const,
};

export function exportUrl(path: string, params: Record<string, string | undefined>) {
  return `/api/v1${path}?${qs(params)}`;
}

export function useExplore(params: Record<string, string | undefined>) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: kk.explore(params),
    queryFn: async () => {
      const res = await api<ExplorerResponse>(`/keywords/explore?${qs(params)}`);
      // A fresh search spends credits: refresh the balance shown in the header.
      if (res.creditsCharged > 0) void qc.invalidateQueries({ queryKey: qk.me });
      return res;
    },
    enabled: !!params.q,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useOverview(params: Record<string, string | undefined>) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: kk.overview(params),
    queryFn: async () => {
      const res = await api<KeywordOverview>(`/keywords/overview?${qs(params)}`);
      if (res.creditsCharged > 0) void qc.invalidateQueries({ queryKey: qk.me });
      return res;
    },
    enabled: !!params.q,
    staleTime: 60_000,
  });
}

export function useKeywordLists() {
  return useQuery({ queryKey: kk.lists, queryFn: () => api<KeywordList[]>('/keyword-lists') });
}

export function useKeywordList(id: string) {
  return useQuery({
    queryKey: kk.list(id),
    queryFn: () => api<KeywordList>(`/keyword-lists/${id}`),
  });
}

export function useListItems(id: string, params: Record<string, string | undefined>) {
  return useQuery({
    queryKey: kk.items(id, params),
    queryFn: () => api<Paginated<KeywordListItem>>(`/keyword-lists/${id}/items?${qs(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useClusters(id: string) {
  return useQuery({
    queryKey: kk.clusters(id),
    queryFn: () => api<ClusterSummary[]>(`/keyword-lists/${id}/clusters`),
  });
}

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKeywordListInput) =>
      api<KeywordList>('/keyword-lists', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kk.lists }),
  });
}

export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/keyword-lists/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kk.lists }),
  });
}

export function useAddItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, keywords }: { listId: string; keywords: string[] }) =>
      api<{ added: number; skipped: number; creditsCharged: number }>(
        `/keyword-lists/${listId}/items`,
        {
          method: 'POST',
          body: { keywords },
        },
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: kk.lists });
      if (res.creditsCharged > 0) void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useUpdateItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      note,
      tags,
    }: {
      itemId: string;
      note?: string | null;
      tags?: string[];
    }) =>
      api<void>(`/keyword-lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        body: { note, tags },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keyword-lists', listId] }),
  });
}

export function useRemoveItems(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<{ removed: number }>(`/keyword-lists/${listId}/items/remove`, {
        method: 'POST',
        body: { ids },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['keyword-lists', listId] });
      void qc.invalidateQueries({ queryKey: kk.lists });
    },
  });
}

export function useStartCluster(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Job>(`/keyword-lists/${listId}/cluster`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}
